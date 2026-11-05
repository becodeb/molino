package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	mrand "math/rand"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	maxSessions   = 120
	maxPerSession = 60
	tickRate      = 50 * time.Millisecond
	sessionIdle   = 20 * time.Minute
	sessionMaxAge = 4 * time.Hour
)

type Phase string

const (
	PhaseLobby     Phase = "lobby"
	PhaseCountdown Phase = "countdown"
	PhasePlay      Phase = "play"
	PhasePaused    Phase = "paused"
	PhaseEnd       Phase = "end"
)

type Player struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Team  int    `json:"team"`
	Role  Role   `json:"role"`
	token string
	conn  *Client
}

// Match es una partida de un equipo: la sesión no conoce las reglas de cada juego.
type Match interface {
	Step(dt float64)
	Done() bool
	Humans() map[Role]bool
	Command(r Role, m inMsg)
	Snapshot(phase Phase, count float64) map[string]any
	Dash() map[string]any
	Result() map[string]any
}

type Team struct {
	Index int    `json:"i"`
	Name  string `json:"name"`
	sim   Match
}

type Client struct {
	send      chan []byte
	player    *Player // nil para profe y espectadores
	teacher   bool
	watchTeam int // equipo que mira un espectador; -1 si no corresponde
}

func (c *Client) push(b []byte) {
	select {
	case c.send <- b:
	default: // conexión lenta: se pierde este mensaje, el próximo trae el estado completo
	}
}

type Session struct {
	mu       sync.Mutex
	Code     string
	Kind     string // sala | clase
	Game     string // isla | atrapa
	HostKey  string
	Dur      float64
	Diff     string
	TeamSize int
	Phase    Phase
	Players  map[string]*Player
	Teams    []*Team
	clients  map[*Client]bool
	cfg      *Config
	store    *Store
	count    float64
	tick     int
	created  time.Time
	lastSeen time.Time
	hostID   string
	done     chan struct{}
	results  []map[string]any
}

type Hub struct {
	mu       sync.Mutex
	sessions map[string]*Session
	cfg      *Config
	store    *Store
}

func newHub(cfg *Config, store *Store) *Hub {
	return &Hub{sessions: map[string]*Session{}, cfg: cfg, store: store}
}

func randToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

const codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ"

func (h *Hub) create(game, kind string, dur float64, diff string, teamSize int) *Session {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.sessions) >= maxSessions {
		return nil
	}
	var code string
	for {
		var b [4]byte
		for i := range b {
			b[i] = codeAlphabet[mrand.Intn(len(codeAlphabet))]
		}
		code = string(b[:])
		if _, used := h.sessions[code]; !used {
			break
		}
	}
	s := &Session{Code: code, Game: game, Kind: kind, HostKey: randToken(16), Dur: dur, Diff: diff, TeamSize: teamSize, Phase: PhaseLobby,
		Players: map[string]*Player{}, clients: map[*Client]bool{}, cfg: h.cfg, store: h.store,
		created: time.Now(), lastSeen: time.Now(), done: make(chan struct{})}
	s.Teams = []*Team{{Index: 0, Name: "Equipo 1"}}
	h.sessions[code] = s
	go s.loop(func() {
		h.mu.Lock()
		delete(h.sessions, code)
		h.mu.Unlock()
	})
	return s
}

func (h *Hub) get(code string) *Session {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.sessions[strings.ToUpper(code)]
}

func (h *Hub) stats() map[string]any {
	h.mu.Lock()
	list := make([]*Session, 0, len(h.sessions))
	for _, s := range h.sessions {
		list = append(list, s)
	}
	h.mu.Unlock()
	players, playing := 0, 0
	for _, s := range list {
		s.mu.Lock()
		players += len(s.Players)
		if s.Phase == PhasePlay {
			playing++
		}
		s.mu.Unlock()
	}
	return map[string]any{"salas": len(list), "jugando": playing, "jugadores": players}
}

func diffValue(d string) float64 {
	switch d {
	case "facil":
		return 1.3
	case "dificil":
		return .8
	}
	return 1
}

func cleanName(n string) string {
	n = strings.Join(strings.Fields(n), " ")
	var b strings.Builder
	count := 0
	for _, r := range n {
		if r < 0x20 || r == 0x7f {
			continue
		}
		if count == 18 {
			break
		}
		b.WriteRune(r)
		count++
	}
	if !utf8.ValidString(b.String()) {
		return ""
	}
	return b.String()
}

/* ---------- Bucle ---------- */

func (s *Session) loop(onExit func()) {
	defer onExit()
	t := time.NewTicker(tickRate)
	defer t.Stop()
	dt := tickRate.Seconds()
	for range t.C {
		s.mu.Lock()
		s.tick++
		switch s.Phase {
		case PhaseCountdown:
			s.count -= dt
			if s.count <= 0 {
				s.Phase = PhasePlay
				s.broadcastLobby()
			}
		case PhasePlay:
			allDone := true
			for _, tm := range s.Teams {
				if tm.sim != nil && !tm.sim.Done() {
					s.syncHumans(tm)
					tm.sim.Step(dt)
				}
				if tm.sim != nil && !tm.sim.Done() {
					allDone = false
				}
			}
			if allDone {
				s.finish()
			}
		}
		if s.Phase == PhasePlay || s.Phase == PhasePaused || s.Phase == PhaseCountdown {
			if s.tick%2 == 0 {
				s.broadcastSnapshots()
			}
			if s.tick%10 == 0 {
				s.broadcastDash()
			}
		}
		expired := time.Since(s.created) > sessionMaxAge
		if len(s.clients) > 0 {
			s.lastSeen = time.Now()
		} else if time.Since(s.lastSeen) > sessionIdle {
			expired = true
		}
		s.mu.Unlock()
		if expired {
			return
		}
	}
}

// Un rol lo cubre un bot si quien lo tenía se desconectó.
func (s *Session) syncHumans(tm *Team) {
	h := tm.sim.Humans()
	for _, r := range s.roles() {
		h[r] = false
	}
	for _, p := range s.Players {
		if p.Team == tm.Index && p.conn != nil && p.Role != "" {
			h[p.Role] = true
		}
	}
}

/* ---------- Mensajes de salida ---------- */

func encode(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		log.Printf("json: %v", err)
		return []byte("{}")
	}
	return b
}

func (s *Session) lobbyMsg() map[string]any {
	players := make([]*Player, 0, len(s.Players))
	for _, p := range s.Players {
		players = append(players, p)
	}
	sort.Slice(players, func(i, j int) bool { return players[i].ID < players[j].ID })
	rows := make([]map[string]any, 0, len(players))
	for _, p := range players {
		rows = append(rows, map[string]any{"id": p.ID, "name": p.Name, "team": p.Team, "role": p.Role, "online": p.conn != nil})
	}
	return map[string]any{"t": "lobby", "game": s.Game, "code": s.Code, "kind": s.Kind, "phase": s.Phase, "dur": s.Dur, "diff": s.Diff, "teamSize": s.TeamSize,
		"players": rows, "teams": s.Teams, "host": s.hostID, "count": s.count}
}

func (s *Session) broadcastLobby() {
	b := encode(s.lobbyMsg())
	for c := range s.clients {
		c.push(b)
	}
}

func (s *Session) broadcastSnapshots() {
	byTeam := map[int][]byte{}
	for _, tm := range s.Teams {
		if tm.sim == nil {
			continue
		}
		byTeam[tm.Index] = encode(tm.sim.Snapshot(s.Phase, s.count))
	}
	for c := range s.clients {
		team := c.watchTeam
		if c.player != nil {
			team = c.player.Team
		}
		if b, ok := byTeam[team]; ok {
			c.push(b)
		}
	}
}

func (s *Session) broadcastDash() {
	teams := make([]map[string]any, 0, len(s.Teams))
	for _, tm := range s.Teams {
		row := map[string]any{"i": tm.Index, "name": tm.Name}
		if tm.sim != nil {
			for k, v := range tm.sim.Dash() {
				row[k] = v
			}
		}
		teams = append(teams, row)
	}
	b := encode(map[string]any{"t": "dash", "phase": s.Phase, "game": s.Game, "teams": teams})
	for c := range s.clients {
		if c.teacher {
			c.push(b)
		}
	}
}

/* ---------- Armado de equipos ---------- */

func (s *Session) autoTeams(n int) {
	if n < 1 {
		n = 1
	}
	if n > 20 {
		n = 20
	}
	players := make([]*Player, 0, len(s.Players))
	for _, p := range s.Players {
		players = append(players, p)
	}
	mrand.Shuffle(len(players), func(i, j int) { players[i], players[j] = players[j], players[i] })
	s.Teams = s.Teams[:0]
	for i := 0; i < n; i++ {
		s.Teams = append(s.Teams, &Team{Index: i, Name: "Equipo " + strconv.Itoa(i+1)})
	}
	counters := make([]int, n)
	for i, p := range players {
		t := i % n
		p.Team = t
		p.Role = s.roles()[counters[t]%len(s.roles())]
		counters[t]++
	}
}

func (s *Session) start() {
	seed := time.Now().UnixNano()
	dv := diffValue(s.Diff)
	for _, tm := range s.Teams {
		if s.Game == "atrapa" {
			tm.sim = newAtrapa(s.cfg, s.Dur, dv, seed+int64(tm.Index)*97)
		} else {
			tm.sim = newSim(s.cfg, s.Dur, dv, seed+int64(tm.Index)*97)
		}
		s.syncHumans(tm)
	}
	s.results = nil
	s.Phase = PhaseCountdown
	s.count = 3.2
	s.broadcastLobby()
}

func (s *Session) finish() {
	s.Phase = PhaseEnd
	results := make([]map[string]any, 0, len(s.Teams))
	for _, tm := range s.Teams {
		if tm.sim == nil {
			continue
		}
		members := []map[string]any{}
		for _, p := range s.Players {
			if p.Team == tm.Index {
				members = append(members, map[string]any{"name": p.Name, "role": p.Role})
			}
		}
		r := tm.sim.Result()
		r["i"], r["name"], r["members"], r["humans"] = tm.Index, tm.Name, members, len(members)
		results = append(results, r)
	}
	sort.Slice(results, func(i, j int) bool { return results[i]["score"].(float64) > results[j]["score"].(float64) })
	s.results = results
	b := encode(map[string]any{"t": "end", "results": results, "code": s.Code, "kind": s.Kind, "game": s.Game})
	for c := range s.clients {
		c.push(b)
	}
	s.broadcastLobby()
	if s.store != nil {
		code, game, kind, diff, dur := s.Code, s.Game, s.Kind, s.Diff, s.Dur
		rows := results
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			for _, r := range rows {
				if r["humans"].(int) == 0 || r["score"].(float64) <= 0 {
					continue
				}
				if err := s.store.saveTeam(ctx, code, game, kind, diff, dur, r); err != nil {
					log.Printf("guardar equipo: %v", err)
				}
			}
		}()
	}
}

/* ---------- Mensajes de entrada ---------- */

type inMsg struct {
	T      string  `json:"t"`
	A      float64 `json:"a"`
	V      float64 `json:"v"`
	ID     int     `json:"id"`
	I      int     `json:"i"`
	D      int     `json:"d"`
	On     bool    `json:"on"`
	N      int     `json:"n"`
	Role   Role    `json:"role"`
	Player string  `json:"player"`
	Team   int     `json:"team"`
	Dur    float64 `json:"dur"`
	Diff   string  `json:"diff"`
	K      string  `json:"k"`
	G      string  `json:"g"`
}

var sayKeys = map[string]bool{"red": true, "turn": true, "ready": true, "code": true, "storm": true, "wind": true, "mark": true, "thanks": true, "off": true, "more": true, "less": true}

func (s *Session) roles() []Role {
	if s.Game == "atrapa" {
		return atrapaRoles
	}
	return allRoles
}

func (s *Session) validRole(r Role) bool {
	for _, x := range s.roles() {
		if x == r {
			return true
		}
	}
	return false
}

func (s *Session) handle(c *Client, raw []byte) {
	var m inMsg
	if err := json.Unmarshal(raw, &m); err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	isHost := c.teacher || (c.player != nil && s.Kind == "sala" && c.player.ID == s.hostID)

	switch m.T {
	case "role": // en una sala cada quien elige su rol
		if c.player != nil && s.Kind == "sala" && s.Phase != PhasePlay && s.Phase != PhaseCountdown && s.validRole(m.Role) {
			// El molino lo maneja una sola persona; en Atrapavientos cada rol es de una y se intercambian
			if m.Role == RoleMolino || s.Game == "atrapa" {
				for _, p := range s.Players {
					if p != c.player && p.Team == c.player.Team && p.Role == m.Role {
						p.Role = ""
						if s.Game == "atrapa" {
							p.Role = c.player.Role
						}
					}
				}
			}
			c.player.Role = m.Role
			s.broadcastLobby()
		}
		return
	case "start":
		if isHost && (s.Phase == PhaseLobby || s.Phase == PhaseEnd) && len(s.Players) > 0 {
			s.start()
		}
		return
	case "cfg":
		if isHost && (s.Phase == PhaseLobby || s.Phase == PhaseEnd) {
			if m.Dur >= 60 && m.Dur <= 600 {
				s.Dur = m.Dur
			}
			if m.Diff == "facil" || m.Diff == "normal" || m.Diff == "dificil" {
				s.Diff = m.Diff
			}
			s.broadcastLobby()
		}
		return
	case "teams":
		if c.teacher && (s.Phase == PhaseLobby || s.Phase == PhaseEnd) {
			s.autoTeams(m.N)
			s.broadcastLobby()
		}
		return
	case "assign":
		if c.teacher && s.Phase != PhasePlay && s.Phase != PhaseCountdown {
			if p := s.Players[m.Player]; p != nil && m.Team >= 0 && m.Team < len(s.Teams) {
				p.Team = m.Team
				if s.validRole(m.Role) {
					p.Role = m.Role
				}
				s.broadcastLobby()
			}
		}
		return
	case "kick":
		if c.teacher {
			if p := s.Players[m.Player]; p != nil {
				delete(s.Players, m.Player)
				if p.conn != nil {
					p.conn.push(encode(map[string]string{"t": "kicked"}))
				}
				s.broadcastLobby()
			}
		}
		return
	case "pause":
		if isHost && s.Phase == PhasePlay {
			s.Phase = PhasePaused
			s.broadcastLobby()
		}
		return
	case "resume":
		if isHost && s.Phase == PhasePaused {
			s.Phase = PhasePlay
			s.broadcastLobby()
		}
		return
	case "finish":
		if isHost && (s.Phase == PhasePlay || s.Phase == PhasePaused) {
			s.finish()
		}
		return
	case "again":
		if isHost && s.Phase == PhaseEnd {
			s.Phase = PhaseLobby
			for _, tm := range s.Teams {
				tm.sim = nil
			}
			s.broadcastLobby()
		}
		return
	}

	// Comandos de juego: solo durante la partida y según el rol
	if c.player == nil || s.Phase != PhasePlay {
		return
	}
	if c.player.Team >= len(s.Teams) || s.Teams[c.player.Team].sim == nil {
		return
	}
	if m.T == "say" {
		if sm, ok := s.Teams[c.player.Team].sim.(*Sim); ok && sayKeys[m.K] {
			sm.emit(Event{"k": "say", "m": m.K, "r": c.player.Role, "from": c.player.Name})
		}
		if am, ok := s.Teams[c.player.Team].sim.(*Atrapa); ok && sayKeys[m.K] {
			am.emit(Event{"k": "say", "m": m.K, "r": c.player.Role, "from": c.player.Name})
		}
		return
	}
	s.Teams[c.player.Team].sim.Command(c.player.Role, m)
}

/* ---------- Altas y bajas ---------- */

// attach conecta a un jugador; si trae un token conocido recupera su lugar.
func (s *Session) attach(c *Client, name, token string) (*Player, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var p *Player
	for _, x := range s.Players {
		if token != "" && x.token == token {
			p = x
			break
		}
	}
	if p == nil {
		if len(s.Players) >= maxPerSession {
			return nil, false
		}
		name = cleanName(name)
		if name == "" {
			return nil, false
		}
		p = &Player{ID: randToken(4), Name: name, token: randToken(12)}
		s.Players[p.ID] = p
		if s.Kind == "sala" {
			if s.hostID == "" {
				s.hostID = p.ID
			}
			taken := map[Role]bool{}
			for _, x := range s.Players {
				if x != p {
					taken[x.Role] = true
				}
			}
			order := []Role{RoleMolino, RoleLuces, RoleRed, RoleVigia}
			if s.Game == "atrapa" {
				order = atrapaRoles
			}
			for _, r := range order {
				if !taken[r] {
					p.Role = r
					break
				}
			}
			if p.Role == "" {
				p.Role = order[len(order)-1]
			}
		} else if len(s.Teams) > 0 {
			// Hasta que el profe arme los equipos, todos esperan en el primero
			count := 0
			for _, x := range s.Players {
				if x != p && x.Team == 0 {
					count++
				}
			}
			p.Team = 0
			p.Role = s.roles()[count%len(s.roles())]
		}
	}
	if p.conn != nil {
		p.conn.push(encode(map[string]string{"t": "replaced"}))
		delete(s.clients, p.conn)
	}
	p.conn = c
	c.player = p
	s.clients[c] = true
	c.push(encode(map[string]any{"t": "hello", "id": p.ID, "token": p.token, "name": p.Name}))
	c.push(encode(s.lobbyMsg()))
	if s.Phase == PhaseEnd && s.results != nil {
		c.push(encode(map[string]any{"t": "end", "results": s.results, "code": s.Code, "kind": s.Kind, "game": s.Game}))
	}
	s.broadcastLobby()
	return p, true
}

func (s *Session) attachWatcher(c *Client) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.clients[c] = true
	c.push(encode(s.lobbyMsg()))
	if s.Phase == PhaseEnd && s.results != nil {
		c.push(encode(map[string]any{"t": "end", "results": s.results, "code": s.Code, "kind": s.Kind, "game": s.Game}))
	}
}

func (s *Session) detach(c *Client) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.clients, c)
	if c.player != nil && c.player.conn == c {
		c.player.conn = nil
		s.broadcastLobby()
	}
}
