package main

import (
	"math"
	"math/rand"
)

// Simulación de un equipo. Es determinista respecto del tiempo que recibe y no
// sabe nada de red: la sesión le pasa los comandos y lee el estado.

type Role string

const (
	RoleVigia  Role = "vigia"
	RoleMolino Role = "molino"
	RoleRed    Role = "red"
	RoleLuces  Role = "luces"
)

var allRoles = []Role{RoleVigia, RoleMolino, RoleRed, RoleLuces}

// Mismo orden que W.houses en el navegador (mundo con semilla fija): barrio de cada casa.
var houseDistrict = []int{0, 1, 0, 3, 0, 1, 0, 1, 2, 3, 1, 2, 2, 1, 0, 3, 3, 2, 3}

var districtNames = []string{"Puerto", "Colina", "Tulipanes", "Bosque"}

const (
	houseDark    = 0 // apagada, sin nadie
	houseWants   = 1 // llegó gente y pide luz
	houseOn      = 2 // encendida y con gente
	houseLeaving = 3 // encendida, se acaba de ir la gente: hay que apagarla
	houseWasting = 4 // encendida sin nadie: gasta energía de más

	tolerance  = 25 * math.Pi / 180
	perfect    = 9 * math.Pi / 180
	botLinkCap = 0.6
)

type Gust struct {
	ID      int     `json:"id"`
	Angle   float64 `json:"a"`
	Born    float64 `json:"b"` // lo ve el vigía
	Fly     float64 `json:"f"` // entra por la costa
	Arrive  float64 `json:"r"` // llega al molino
	Gold    bool    `json:"g"`
	Pinged  bool    `json:"p"`
	botPing float64
	botMiss bool
}

type Storm struct {
	ID        int     `json:"id"`
	District  int     `json:"d"`
	Born      float64 `json:"b"`
	Hit       float64 `json:"h"`
	Warned    bool    `json:"w"`
	Protected bool    `json:"s"`
	botWarn   float64
	botProt   float64
}

type District struct {
	Broken  bool    `json:"x"`
	Tripped bool    `json:"t"`
	Repair  float64 `json:"p"` // progreso 0..1
	holding bool
	botIn   float64
}

type House struct {
	State    int
	Deadline float64 // cuándo vence el estado actual
	botAt    float64 // cuándo actúa el bot
	botSkip  bool
}

type Stats struct {
	Hits      int     `json:"hits"`
	Misses    int     `json:"misses"`
	Perfects  int     `json:"perfects"`
	BestCombo int     `json:"bestCombo"`
	Pings     int     `json:"pings"`
	PingsLate int     `json:"pingsLate"`
	PingsLost int     `json:"pingsLost"`
	Warned    int     `json:"warned"`
	Storms    int     `json:"storms"`
	Protected int     `json:"protected"`
	Repairs   int     `json:"repairs"`
	Trips     int     `json:"trips"`
	Served    int     `json:"served"`
	Unserved  int     `json:"unserved"`
	OffOK     int     `json:"offOk"`
	OffLate   int     `json:"offLate"`
	Wrong     int     `json:"wrong"`
	Wasted    float64 `json:"wasted"`
	DarkSecs  float64 `json:"darkSecs"`
	SyncSum   float64 `json:"-"`
	SyncN     float64 `json:"-"`
	SyncAvg   float64 `json:"syncAvg"`
	SyncPeak  float64 `json:"syncPeak"`
}

type Event map[string]any

type Sim struct {
	cfg *Config
	rng *rand.Rand

	T, Dur float64
	Diff   float64 // 1 normal; mayor = más tiempo para todo

	Score    float64
	Links    [4]float64 // vigía, molino, red, luces
	Sync     float64
	Battery  float64
	Flow     float64 // 0..1 pedido por la red
	Heat     float64
	Demand   float64
	Supply   float64
	Power    float64 // fracción de la demanda cubierta
	Mill     float64
	millVel  float64
	Combo    int
	Houses   [19]House
	Dists    [4]District
	Gusts    []*Gust
	Storms   []*Storm
	Stats    Stats
	Timeline []float64

	Human   map[Role]bool // roles con una persona conectada
	nextID  int
	gustIn  float64
	callIn  float64
	stormIn float64
	lastA   float64
	lastS   float64
	secT    float64
	chainT  float64
	chainCD float64
	flowBot float64
	events  []Event
}

func newSim(cfg *Config, dur, diff float64, seed int64) *Sim {
	s := &Sim{cfg: cfg, rng: rand.New(rand.NewSource(seed)), Dur: dur, Diff: diff,
		Battery: 40, Flow: .25, Power: 1, Human: map[Role]bool{}, gustIn: 1.5, callIn: 1, lastS: 1, Sync: 1,
		// Listas siempre presentes: vacías viajan como [] y no como null
		Gusts: []*Gust{}, Storms: []*Storm{}, Timeline: []float64{}}
	s.Links = [4]float64{.7, .7, .7, .7}
	s.stormIn = cfg.Num("grupal.tormenta_cada") * .6 * diff
	s.Mill = s.rng.Float64() * 2 * math.Pi
	s.lastA = s.Mill
	return s
}

func (s *Sim) emit(e Event) { s.events = append(s.events, e) }

// DrainEvents entrega lo ocurrido desde la última llamada.
func (s *Sim) DrainEvents() []Event { e := s.events; s.events = nil; return e }

func lerp(a, b, t float64) float64  { return a + (b-a)*t }
func clamp(v, a, b float64) float64 { return math.Min(b, math.Max(a, v)) }
func angDiff(a, b float64) float64 {
	d := math.Mod(a-b, 2*math.Pi)
	if d > math.Pi {
		d -= 2 * math.Pi
	}
	if d < -math.Pi {
		d += 2 * math.Pi
	}
	return d
}
func (s *Sim) randf(a, b float64) float64 { return a + s.rng.Float64()*(b-a) }

func (s *Sim) link(i int, v, alpha float64) {
	s.Links[i] += (v - s.Links[i]) * alpha
}

func (s *Sim) award(base float64) int {
	p := base * s.Sync
	s.Score += p
	return int(math.Round(p))
}

// Done indica que terminó el tiempo.
func (s *Sim) Done() bool { return s.T >= s.Dur }

// Step avanza la partida dt segundos.
func (s *Sim) Step(dt float64) {
	s.T += dt
	s.spawn(dt)
	s.bots(dt)
	s.stepGusts()
	s.stepStorms()
	s.stepHouses()
	s.stepGrid(dt)
	s.stepScore(dt)
}

func (s *Sim) progress() float64 { return clamp(s.T/s.Dur, 0, 1) }

func (s *Sim) spawn(dt float64) {
	p := s.progress()
	s.gustIn -= dt
	if s.gustIn <= 0 && s.T < s.Dur-2 {
		gap := lerp(s.cfg.Num("grupal.gap_inicio"), s.cfg.Num("grupal.gap_final"), p) * s.Diff
		travel := lerp(s.cfg.Num("grupal.viaje_inicio"), s.cfg.Num("grupal.viaje_final"), p) * s.Diff
		lead := s.cfg.Num("grupal.aviso_vigia")
		maxD := math.Min(170*math.Pi/180, gap*125*math.Pi/180*.62)
		if s.rng.Float64() > .66 {
			s.lastS = -s.lastS
		}
		s.lastA += s.randf(math.Min(38*math.Pi/180, maxD*.5), maxD) * s.lastS
		s.nextID++
		s.Gusts = append(s.Gusts, &Gust{ID: s.nextID, Angle: s.lastA, Born: s.T, Fly: s.T + lead, Arrive: s.T + lead + travel,
			Gold: s.T > 12 && s.rng.Float64() < .12, botPing: s.T + s.randf(.7, 2.2), botMiss: s.rng.Float64() < .2})
		s.gustIn = gap
	}
	s.callIn -= dt
	if s.callIn <= 0 && s.T < s.Dur-3 {
		s.callIn = lerp(s.cfg.Num("grupal.llamada_inicio"), s.cfg.Num("grupal.llamada_final"), p) * s.Diff
		var free []int
		for i := range s.Houses {
			if s.Houses[i].State == houseDark && !s.Dists[houseDistrict[i]].Broken {
				free = append(free, i)
			}
		}
		if len(free) > 0 {
			i := free[s.rng.Intn(len(free))]
			s.Houses[i] = House{State: houseWants, Deadline: s.T + s.cfg.Num("grupal.espera_pedido")*s.Diff,
				botAt: s.T + s.randf(1.5, 5), botSkip: s.rng.Float64() < .12}
			s.emit(Event{"k": "call", "i": i})
		}
	}
	s.stormIn -= dt
	if s.stormIn <= 0 && s.T < s.Dur-12 {
		s.stormIn = s.cfg.Num("grupal.tormenta_cada") * s.randf(.85, 1.15) * s.Diff
		d := s.rng.Intn(4)
		for tries := 0; tries < 4 && s.Dists[d].Broken; tries++ {
			d = (d + 1) % 4
		}
		s.nextID++
		s.Storms = append(s.Storms, &Storm{ID: s.nextID, District: d, Born: s.T, Hit: s.T + 10*s.Diff,
			botWarn: s.T + s.randf(1.2, 3.2), botProt: s.T + s.randf(3, 7)})
		s.Stats.Storms++
	}
}

func (s *Sim) stepGusts() {
	notice := s.cfg.Num("grupal.niebla") * s.Diff
	out := s.Gusts[:0]
	for _, g := range s.Gusts {
		if !g.Pinged && s.T > g.Arrive-notice && g.botPing >= 0 {
			// El vigía no llegó a marcarla: el molino la va a ver tarde
			s.Stats.PingsLost++
			s.link(0, 0, .22)
			g.botPing = -1
		}
		if s.T < g.Arrive {
			out = append(out, g)
			continue
		}
		off := math.Abs(angDiff(s.Mill, g.Angle))
		hit := off <= tolerance
		perf := hit && off <= perfect
		ev := Event{"k": "gust", "id": g.ID, "hit": hit, "perfect": perf, "a": g.Angle, "gold": g.Gold}
		if hit {
			s.Stats.Hits++
			s.Combo++
			if s.Combo > s.Stats.BestCombo {
				s.Stats.BestCombo = s.Combo
			}
			gain := s.cfg.Num("grupal.energia_rafaga")
			base := 40.0
			if perf {
				s.Stats.Perfects++
				gain *= 1.35
				base = 55
			}
			if g.Gold {
				gain *= 1.6
				base *= 2
			}
			s.Battery = clamp(s.Battery+gain, 0, 100)
			ev["pts"] = s.award(base * (1 + math.Min(1, float64(s.Combo)*.1)))
			ev["combo"] = s.Combo
			s.link(1, 1, .2)
		} else {
			s.Stats.Misses++
			s.Combo = 0
			s.link(1, 0, .2)
		}
		s.emit(ev)
	}
	s.Gusts = out
}

func (s *Sim) stepStorms() {
	out := s.Storms[:0]
	for _, st := range s.Storms {
		if s.T < st.Hit {
			out = append(out, st)
			continue
		}
		if st.Protected {
			s.Stats.Protected++
			s.link(2, 1, .25)
			s.emit(Event{"k": "storm", "d": st.District, "safe": true, "pts": s.award(60)})
		} else {
			s.Dists[st.District].Broken = true
			s.Dists[st.District].Repair = 0
			s.Dists[st.District].botIn = s.T + s.randf(2, 4)
			s.link(2, .2, .2)
			if !st.Warned {
				s.link(0, 0, .3)
			}
			s.emit(Event{"k": "storm", "d": st.District, "safe": false})
		}
	}
	s.Storms = out
}

func (s *Sim) stepHouses() {
	for i := range s.Houses {
		h := &s.Houses[i]
		switch h.State {
		case houseWants:
			if s.T >= h.Deadline {
				h.State = houseDark
				s.Stats.Unserved++
				s.link(3, 0, .2)
				s.emit(Event{"k": "angry", "i": i})
			}
		case houseOn:
			if s.T >= h.Deadline {
				h.State = houseLeaving
				h.Deadline = s.T + s.cfg.Num("grupal.espera_apagar")*s.Diff
				h.botAt = s.T + s.randf(1, 4)
				h.botSkip = s.rng.Float64() < .1
				s.emit(Event{"k": "left", "i": i})
			}
		case houseLeaving:
			if s.T >= h.Deadline {
				h.State = houseWasting
				s.Stats.OffLate++
				s.link(3, .1, .2)
			}
		}
	}
}

func (s *Sim) lit(i int) bool {
	st := s.Houses[i].State
	return st == houseOn || st == houseLeaving || st == houseWasting
}

func (s *Sim) stepGrid(dt float64) {
	cons := s.cfg.Num("grupal.consumo_casa")
	demand := 0.0
	dark, occupied := 0, 0
	for i := range s.Houses {
		if !s.lit(i) {
			continue
		}
		d := &s.Dists[houseDistrict[i]]
		if d.Broken || d.Tripped {
			dark++
			continue
		}
		demand += cons
		if s.Houses[i].State == houseOn {
			occupied++
		} else {
			s.Stats.Wasted += cons * dt
		}
	}
	supply := s.Flow * s.cfg.Num("grupal.flujo_max")
	if s.Battery <= 0 {
		supply = 0
	}
	s.Battery = clamp(s.Battery-supply*dt, 0, 100)
	s.Demand, s.Supply = demand, supply
	if demand > 0 {
		s.Power = math.Min(1, supply/demand)
	} else {
		s.Power = 1
	}
	over := supply > demand*1.35+.6
	if over {
		s.Heat = clamp(s.Heat+(supply-demand)*6*dt, 0, 100)
	} else {
		s.Heat = clamp(s.Heat-12*dt, 0, 100)
	}
	if s.Heat >= 100 {
		s.Heat = 45
		var live []int
		for i := range s.Dists {
			if !s.Dists[i].Broken && !s.Dists[i].Tripped {
				live = append(live, i)
			}
		}
		if len(live) > 0 {
			d := live[s.rng.Intn(len(live))]
			s.Dists[d].Tripped = true
			s.Dists[d].botIn = s.T + s.randf(1.5, 3)
			s.Stats.Trips++
			s.link(2, 0, .15)
			s.emit(Event{"k": "trip", "d": d})
		}
	}
	// Reparaciones: progresan mientras alguien mantiene apretado
	for i := range s.Dists {
		d := &s.Dists[i]
		if !d.Broken {
			continue
		}
		if d.holding {
			d.Repair += dt / s.cfg.Num("grupal.reparacion")
			if d.Repair >= 1 {
				d.Broken, d.Repair, d.holding = false, 0, false
				s.Stats.Repairs++
				s.link(2, 1, .15)
				s.emit(Event{"k": "fixed", "d": i, "pts": s.award(30)})
			}
		}
	}
	s.secT += dt
	if s.secT >= 1 {
		s.secT -= 1
		v := s.Power
		if s.Battery <= 0 {
			v = 0
			s.Stats.DarkSecs++
		}
		if over {
			v *= .7
		}
		if dark > 0 {
			v *= .7
		}
		s.link(2, v, .12)
		if int(s.T)%5 == 0 {
			s.Timeline = append(s.Timeline, math.Round(s.Score))
		}
	}
	// Las personas conectadas ganan puntos por cada casa con gente y luz
	s.Score += float64(occupied) * 2.2 * s.Power * s.Sync * dt
}

func (s *Sim) stepScore(dt float64) {
	links := s.Links
	for i, r := range allRoles {
		if !s.Human[r] {
			links[i] = math.Min(links[i], botLinkCap)
		}
	}
	s.Links = links
	gm := math.Pow(clamp(links[0], .01, 1)*clamp(links[1], .01, 1)*clamp(links[2], .01, 1)*clamp(links[3], .01, 1), .25)
	s.Sync = .4 + 1.6*math.Pow(gm, 1.3)
	s.Stats.SyncSum += s.Sync * dt
	s.Stats.SyncN += dt
	s.Stats.SyncPeak = math.Max(s.Stats.SyncPeak, s.Sync)
	if s.Stats.SyncN > 0 {
		s.Stats.SyncAvg = s.Stats.SyncSum / s.Stats.SyncN
	}
	s.chainCD -= dt
	if gm > .8 {
		s.chainT += dt
		if s.chainT > 6 && s.chainCD <= 0 {
			s.chainCD = 15
			s.emit(Event{"k": "chain", "pts": s.award(100)})
		}
	} else {
		s.chainT = 0
	}
}

/* ---------- Comandos de los jugadores ---------- */

func (s *Sim) CmdMill(a float64) {
	if !math.IsNaN(a) && !math.IsInf(a, 0) {
		s.Mill = a
	}
}

func (s *Sim) CmdPing(id int) {
	for _, g := range s.Gusts {
		if g.ID == id && !g.Pinged {
			g.Pinged = true
			early := s.T < g.Fly
			pts := 8.0
			if early {
				pts = 15
				s.Stats.Pings++
				s.link(0, 1, .22)
			} else {
				s.Stats.PingsLate++
				s.link(0, .6, .22)
			}
			s.emit(Event{"k": "ping", "id": id, "a": g.Angle, "pts": s.award(pts)})
			return
		}
	}
}

func (s *Sim) CmdWarn(id int) {
	for _, st := range s.Storms {
		if st.ID == id && !st.Warned {
			st.Warned = true
			s.Stats.Warned++
			s.link(0, 1, .3)
			s.emit(Event{"k": "warn", "d": st.District, "pts": s.award(20)})
			return
		}
	}
}

func (s *Sim) CmdFlow(v float64) {
	if !math.IsNaN(v) {
		s.Flow = clamp(v, 0, 1)
	}
}

// CmdProtect blinda un barrio contra una tormenta avisada; cuesta batería.
func (s *Sim) CmdProtect(id int) {
	for _, st := range s.Storms {
		if st.ID == id && st.Warned && !st.Protected && s.Battery >= 6 {
			st.Protected = true
			s.Battery -= 6
			s.emit(Event{"k": "shield", "d": st.District})
			return
		}
	}
}

func (s *Sim) CmdReset(d int) {
	if d >= 0 && d < 4 && s.Dists[d].Tripped {
		s.Dists[d].Tripped = false
		s.emit(Event{"k": "reset", "d": d})
	}
}

func (s *Sim) CmdRepair(d int, on bool) {
	if d >= 0 && d < 4 {
		s.Dists[d].holding = on && s.Dists[d].Broken
		if !on {
			s.Dists[d].Repair *= .6
		}
	}
}

func (s *Sim) CmdHouse(i int) {
	if i < 0 || i >= len(s.Houses) {
		return
	}
	h := &s.Houses[i]
	switch h.State {
	case houseWants:
		h.State = houseOn
		h.Deadline = s.T + s.randf(11, 24)
		s.Stats.Served++
		s.link(3, 1, .2)
		s.emit(Event{"k": "served", "i": i, "pts": s.award(30)})
	case houseOn:
		// Apagó a una familia que seguía en casa
		h.State = houseWants
		h.Deadline = s.T + 4
		h.botAt = s.T + 1
		s.Stats.Wrong++
		s.link(3, 0, .2)
		s.emit(Event{"k": "wrong", "i": i})
	case houseLeaving:
		h.State = houseDark
		s.Stats.OffOK++
		s.link(3, 1, .2)
		s.emit(Event{"k": "off", "i": i, "pts": s.award(12)})
	case houseWasting:
		h.State = houseDark
		s.link(3, .4, .1)
		s.emit(Event{"k": "off", "i": i, "pts": 0})
	case houseDark:
		// Prendió una casa vacía
		h.State = houseWasting
		s.Stats.Wrong++
		s.link(3, .2, .15)
		s.emit(Event{"k": "wrong", "i": i})
	}
}

/* ---------- Bots: cubren los roles sin persona, sin llegar a su nivel ---------- */

func (s *Sim) bots(dt float64) {
	if !s.Human[RoleVigia] {
		for _, g := range s.Gusts {
			if !g.Pinged && g.botPing > 0 && s.T >= g.botPing {
				s.CmdPing(g.ID)
			}
		}
		for _, st := range s.Storms {
			if !st.Warned && s.T >= st.botWarn {
				s.CmdWarn(st.ID)
			}
		}
	}
	if !s.Human[RoleMolino] {
		var next *Gust
		notice := s.cfg.Num("grupal.niebla") * s.Diff
		for _, g := range s.Gusts {
			if (g.Pinged || s.T > g.Arrive-notice) && (next == nil || g.Arrive < next.Arrive) {
				next = g
			}
		}
		if next != nil && !next.botMiss {
			d := angDiff(next.Angle, s.Mill)
			if math.Abs(d) > 8*math.Pi/180 {
				s.millVel = math.Copysign(125*math.Pi/180, d)
				step := s.millVel * dt
				if math.Abs(step) > math.Abs(d) {
					step = d
				}
				s.Mill += step
			}
		}
	}
	if !s.Human[RoleRed] {
		want := (s.Demand*1.15 + .3) / s.cfg.Num("grupal.flujo_max")
		s.Flow += (clamp(want, 0, 1) - s.Flow) * (1 - math.Exp(-dt/1.5))
		for i := range s.Dists {
			d := &s.Dists[i]
			if d.Tripped && s.T >= d.botIn {
				s.CmdReset(i)
			}
			if d.Broken && s.T >= d.botIn {
				d.holding = true
			}
		}
		for _, st := range s.Storms {
			if st.Warned && !st.Protected && s.T >= st.botProt && st.ID%3 != 0 {
				s.CmdProtect(st.ID)
			}
		}
	}
	if !s.Human[RoleLuces] {
		for i := range s.Houses {
			h := &s.Houses[i]
			if (h.State == houseWants || h.State == houseLeaving) && !h.botSkip && s.T >= h.botAt {
				s.CmdHouse(i)
			}
		}
	}
}
