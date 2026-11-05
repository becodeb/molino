// Servidor del Desafío del Molino: sirve el juego y guarda el ranking global en Postgres.
package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
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

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed index.html
var static embed.FS

const (
	maxNameLen = 18
	topLimit   = 10
	// Tope holgado: ni acertando todas las ráfagas de 90 s se llega a este puntaje.
	maxScore  = 120000
	maxGusts  = 90
	minPlayed = 20 // segundos: una partida más corta no entra al ranking, salvo apagón
	postLimit = 6  // partidas guardadas por minuto y por IP
)

const schema = `
CREATE TABLE IF NOT EXISTS scores (
	id         BIGSERIAL PRIMARY KEY,
	name       TEXT        NOT NULL,
	score      INTEGER     NOT NULL CHECK (score >= 0),
	hits       INTEGER     NOT NULL CHECK (hits >= 0),
	misses     INTEGER     NOT NULL CHECK (misses >= 0),
	best_combo INTEGER     NOT NULL CHECK (best_combo >= 0),
	efficiency INTEGER     NOT NULL CHECK (efficiency BETWEEN 0 AND 100),
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scores_rank_idx ON scores (score DESC, created_at ASC);
`

type entry struct {
	Rank       int    `json:"rank"`
	Name       string `json:"name"`
	Score      int    `json:"score"`
	Hits       int    `json:"hits"`
	Misses     int    `json:"misses"`
	BestCombo  int    `json:"bestCombo"`
	Efficiency int    `json:"efficiency"`
}

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

// limiter cuenta envíos por IP en ventanas de un minuto.
type limiter struct {
	mu     sync.Mutex
	window time.Time
	count  map[string]int
}

func (l *limiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now := time.Now(); now.Sub(l.window) > time.Minute {
		l.window, l.count = now, map[string]int{}
	}
	l.count[ip]++
	return l.count[ip] <= postLimit
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

type server struct {
	db  *pgxpool.Pool
	lim *limiter
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("respuesta: %v", err)
	}
}

func (s *server) top(ctx context.Context) ([]entry, error) {
	rows, err := s.db.Query(ctx, `
		SELECT name, score, hits, misses, best_combo, efficiency
		FROM scores ORDER BY score DESC, created_at ASC LIMIT $1`, topLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]entry, 0, topLimit)
	for rows.Next() {
		e := entry{Rank: len(list) + 1}
		if err := rows.Scan(&e.Name, &e.Score, &e.Hits, &e.Misses, &e.BestCombo, &e.Efficiency); err != nil {
			return nil, err
		}
		list = append(list, e)
	}
	return list, rows.Err()
}

func (s *server) getScores(w http.ResponseWriter, r *http.Request) {
	list, err := s.top(r.Context())
	if err != nil {
		log.Printf("leer ranking: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "ranking no disponible"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"top": list})
}

func (s *server) postScore(w http.ResponseWriter, r *http.Request) {
	if !s.lim.allow(clientIP(r)) {
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
	ctx := r.Context()
	var id int64
	err := s.db.QueryRow(ctx, `
		INSERT INTO scores (name, score, hits, misses, best_combo, efficiency)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		sub.Name, sub.Score, sub.Hits, sub.Misses, sub.BestCombo, sub.Efficiency).Scan(&id)
	if err != nil {
		log.Printf("guardar partida: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no se pudo guardar"})
		return
	}
	var rank int
	if err := s.db.QueryRow(ctx, `
		SELECT count(*) + 1 FROM scores
		WHERE score > $1 OR (score = $1 AND id < $2)`, sub.Score, id).Scan(&rank); err != nil {
		log.Printf("calcular puesto: %v", err)
	}
	list, err := s.top(ctx)
	if err != nil {
		log.Printf("leer ranking: %v", err)
		list = []entry{}
	}
	writeJSON(w, http.StatusCreated, map[string]any{"rank": rank, "top": list})
}

func connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 8
	var lastErr error
	// Postgres puede tardar en aceptar conexiones cuando arranca el stack.
	for i := 0; i < 30; i++ {
		var pool *pgxpool.Pool
		if pool, lastErr = pgxpool.NewWithConfig(ctx, cfg); lastErr == nil {
			if lastErr = pool.Ping(ctx); lastErr == nil {
				return pool, nil
			}
			pool.Close()
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return nil, lastErr
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

	db, err := connect(ctx, url)
	if err != nil {
		log.Fatalf("base de datos: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(ctx, schema, pgx.QueryExecModeSimpleProtocol); err != nil {
		log.Fatalf("esquema: %v", err)
	}

	s := &server{db: db, lim: &limiter{}}
	page, err := static.ReadFile("index.html")
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/scores", s.getScores)
	mux.HandleFunc("POST /api/scores", s.postScore)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := db.Ping(r.Context()); err != nil {
			http.Error(w, "db", http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(page)
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
