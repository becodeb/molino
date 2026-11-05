// Servidor de Atrapavientos: sirve el juego, coordina las partidas grupales
// por WebSocket y guarda rankings y configuración en Postgres.
package main

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"
)

//go:embed web
var webFiles embed.FS

const (
	maxNameLen = 18
	topLimit   = 10
	// Tope holgado: ni acertando todas las ráfagas de 90 s se llega a este puntaje.
	maxScore  = 120000
	maxGusts  = 90
	minPlayed = 20 // segundos: una partida más corta no entra al ranking, salvo apagón
	postLimit = 6  // partidas guardadas por minuto y por IP
)

type submission struct {
	Name       string `json:"name"`
	Score      int    `json:"score"`
	Hits       int    `json:"hits"`
	Misses     int    `json:"misses"`
	BestCombo  int    `json:"bestCombo"`
	Efficiency int    `json:"efficiency"`
	Seconds    int    `json:"seconds"`
}

// validate limpia el nombre y descarta partidas imposibles. El juego corre en el
// navegador, así que esto frena abusos obvios, no a alguien decidido a hacer trampa.
func (s *submission) validate() error {
	name := strings.Join(strings.Fields(s.Name), " ")
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			return errors.New("nombre inválido")
		}
	}
	if n := utf8.RuneCountInString(name); n == 0 || n > maxNameLen {
		return errors.New("el nombre debe tener entre 1 y 18 caracteres")
	}
	s.Name = name
	total := s.Hits + s.Misses
	switch {
	case s.Score < 0 || s.Score > maxScore,
		s.Hits < 0, s.Misses < 0, total > maxGusts,
		s.BestCombo < 0, s.BestCombo > s.Hits,
		s.Efficiency < 0, s.Efficiency > 100,
		s.Seconds < 0, s.Seconds > 95,
		s.Seconds < minPlayed && s.Efficiency > 0,
		s.Hits == 0 && s.Score > 1500:
		return errors.New("partida inválida")
	}
	return nil
}

// limiter cuenta usos por IP en ventanas de un minuto.
type limiter struct {
	mu     sync.Mutex
	max    int
	window time.Time
	count  map[string]int
}

func newLimiter(max int) *limiter { return &limiter{max: max} }

func (l *limiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now := time.Now(); now.Sub(l.window) > time.Minute {
		l.window, l.count = now, map[string]int{}
	}
	l.count[ip]++
	return l.count[ip] <= l.max
}

func clientIP(r *http.Request) string {
	if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
		return ip
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.SplitN(xff, ",", 2)[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("respuesta: %v", err)
	}
}

type server struct {
	store     *Store
	hub       *Hub
	cfg       *Config
	scoreLim  *limiter
	createLim *limiter
}

func (s *server) getScores(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.topScores(r.Context())
	if err != nil {
		log.Printf("leer ranking: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "ranking no disponible"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"top": list})
}

func (s *server) postScore(w http.ResponseWriter, r *http.Request) {
	if !s.scoreLim.allow(clientIP(r)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "demasiadas partidas seguidas, probá en un minuto"})
		return
	}
	var sub submission
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&sub); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "datos inválidos"})
		return
	}
	if err := sub.validate(); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	rank, err := s.store.addScore(r.Context(), sub)
	if err != nil {
		log.Printf("guardar partida: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no se pudo guardar"})
		return
	}
	list, err := s.store.topScores(r.Context())
	if err != nil {
		log.Printf("leer ranking: %v", err)
		list = []entry{}
	}
	writeJSON(w, http.StatusCreated, map[string]any{"rank": rank, "top": list})
}

func (s *server) createSession(w http.ResponseWriter, r *http.Request) {
	if !s.createLim.allow(clientIP(r)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "demasiadas salas seguidas, probá en un minuto"})
		return
	}
	var in struct {
		Game     string  `json:"game"`
		Kind     string  `json:"kind"`
		Dur      float64 `json:"dur"`
		Diff     string  `json:"diff"`
		TeamSize int     `json:"teamSize"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "datos inválidos"})
		return
	}
	if in.Kind != "clase" {
		in.Kind = "sala"
	}
	if in.Game != "atrapa" {
		in.Game = "isla"
	}
	if in.Dur < 60 || in.Dur > 600 {
		in.Dur = 180
	}
	if in.Diff != "facil" && in.Diff != "dificil" {
		in.Diff = "normal"
	}
	if in.Game == "atrapa" {
		in.TeamSize = 2
	} else if in.TeamSize < 2 || in.TeamSize > 8 {
		in.TeamSize = 4
	}
	sess := s.hub.create(in.Game, in.Kind, in.Dur, in.Diff, in.TeamSize)
	if sess == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "hay demasiadas salas abiertas, probá en un rato"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"code": sess.Code, "key": sess.HostKey})
}

func (s *server) sessionInfo(w http.ResponseWriter, r *http.Request) {
	sess := s.hub.get(r.PathValue("code"))
	if sess == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no existe esa sala"})
		return
	}
	sess.mu.Lock()
	defer sess.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"code": sess.Code, "game": sess.Game, "kind": sess.Kind, "phase": sess.Phase, "players": len(sess.Players)})
}

func (s *server) topTeams(w http.ResponseWriter, r *http.Request) {
	game := r.URL.Query().Get("game")
	if game != "atrapa" {
		game = "isla"
	}
	list, err := s.store.topTeams(r.Context(), game)
	if err != nil {
		log.Printf("ranking equipos: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "ranking no disponible"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"top": list})
}

// ws atiende jugadores, profes (as=profe) y espectadores (as=ver).
func (s *server) ws(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	sess := s.hub.get(q.Get("code"))
	if sess == nil {
		http.Error(w, "no existe esa sala", http.StatusNotFound)
		return
	}
	as := q.Get("as")
	if as == "profe" && q.Get("k") != sess.HostKey {
		http.Error(w, "clave de profe incorrecta", http.StatusForbidden)
		return
	}
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(2048)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	defer conn.CloseNow()

	c := &Client{send: make(chan []byte, 64), watchTeam: -1}
	switch as {
	case "profe":
		c.teacher = true
		if t, err := strconv.Atoi(q.Get("team")); err == nil {
			c.watchTeam = t
		}
		sess.attachWatcher(c)
	case "ver":
		t, _ := strconv.Atoi(q.Get("team"))
		c.watchTeam = t
		sess.attachWatcher(c)
	default:
		if _, ok := sess.attach(c, q.Get("name"), q.Get("token")); !ok {
			conn.Close(websocket.StatusPolicyViolation, "sala llena o nombre inválido")
			return
		}
	}
	defer sess.detach(c)

	go func() {
		ping := time.NewTicker(20 * time.Second)
		defer ping.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case b := <-c.send:
				wc, cancelW := context.WithTimeout(ctx, 4*time.Second)
				err := conn.Write(wc, websocket.MessageText, b)
				cancelW()
				if err != nil {
					cancel()
					return
				}
			case <-ping.C:
				pc, cancelP := context.WithTimeout(ctx, 10*time.Second)
				err := conn.Ping(pc)
				cancelP()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		sess.handle(c, data)
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Permissions-Policy", "camera=(self), microphone=()")
		next.ServeHTTP(w, r)
	})
}

func page(web fs.FS, name string) http.HandlerFunc {
	b, err := fs.ReadFile(web, name)
	if err != nil {
		log.Fatal(err)
	}
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(b)
	}
}

func main() {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("falta DATABASE_URL")
	}
	port := os.Getenv("PORT")
	if _, err := strconv.Atoi(port); err != nil {
		port = "8080"
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store, err := connect(ctx, url)
	if err != nil {
		log.Fatalf("base de datos: %v", err)
	}
	defer store.db.Close()
	cfg, err := newConfig(ctx, store)
	if err != nil {
		log.Fatalf("configuración: %v", err)
	}
	web, err := fs.Sub(webFiles, "web")
	if err != nil {
		log.Fatal(err)
	}

	hub := newHub(cfg, store)
	s := &server{store: store, hub: hub, cfg: cfg, scoreLim: newLimiter(postLimit), createLim: newLimiter(20)}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		log.Fatal(err)
	}
	router := os.Getenv("AI_ROUTER_URL")
	if router == "" {
		router = "https://ai-router.becode.com.ar"
	}
	dev := &Dev{password: os.Getenv("DEV_PASSWORD"), secret: secret, router: strings.TrimRight(router, "/"), cfg: cfg, store: store, hub: hub, web: web,
		limit: newLimiter(6), client: &http.Client{Timeout: 3 * time.Minute}}
	if dev.password == "" {
		log.Print("aviso: DEV_PASSWORD vacía, /dev queda cerrado")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/scores", s.getScores)
	mux.HandleFunc("POST /api/scores", s.postScore)
	mux.HandleFunc("POST /api/salas", s.createSession)
	mux.HandleFunc("GET /api/salas/{code}", s.sessionInfo)
	mux.HandleFunc("GET /api/equipos/top", s.topTeams)
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, cfg.All()) })
	mux.HandleFunc("GET /ws", s.ws)
	mux.HandleFunc("POST /api/dev/login", dev.login)
	mux.HandleFunc("GET /api/dev/state", dev.guard(dev.state))
	mux.HandleFunc("POST /api/dev/config", dev.guard(dev.setConfig))
	mux.HandleFunc("POST /api/dev/revert", dev.guard(dev.revert))
	mux.HandleFunc("POST /api/dev/request", dev.guard(dev.requestDone))
	mux.HandleFunc("POST /api/dev/chat", dev.guard(dev.chat))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := store.db.Ping(r.Context()); err != nil {
			http.Error(w, "db", http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("GET /{$}", page(web, "index.html"))
	mux.HandleFunc("GET /grupal", page(web, "grupal.html"))
	mux.HandleFunc("GET /atrapavientos", page(web, "atrapa.html"))
	mux.HandleFunc("GET /profe", page(web, "profe.html"))
	mux.HandleFunc("GET /dev", page(web, "dev.html"))
	files := http.FileServerFS(web)
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
	}
	go func() {
		<-ctx.Done()
		sd, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(sd)
	}()
	log.Printf("escuchando en :%s", port)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
