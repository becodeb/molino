package main

import (
	"math"
	"math/rand"
)

// Atrapavientos: equipos de dos.
// El Anunciador ve el color de cada viento y activa el modo operativo correcto.
// El Director orienta el molino, pero no ve colores: depende de lo que le digan.
// Tres vientos rojos recibidos de seguido queman los motores hasta repararlos.

const (
	RoleDirector   Role = "director"
	RoleAnunciador Role = "anunciador"

	windVerde    = 0
	windAmarillo = 1
	windRojo     = 2

	modeCaptar     = 0
	modeRefuerzo   = 1
	modeProteccion = 2

	redsToBurn = 3
	codeLen    = 4
)

var atrapaRoles = []Role{RoleDirector, RoleAnunciador}
var repairSigns = []string{"left", "right", "open", "fist"}

type Wind struct {
	ID     int     `json:"id"`
	Angle  float64 `json:"a"`
	Born   float64 `json:"b"`
	Fly    float64 `json:"f"`
	Arrive float64 `json:"r"`
	Color  int     `json:"c"`
	botOff bool
	botAt  float64
}

type AtrapaStats struct {
	Caught    int `json:"caught"`
	Missed    int `json:"missed"`
	WrongMode int `json:"wrongMode"`
	RightMode int `json:"rightMode"`
	RedsHit   int `json:"redsHit"`
	RedsSafe  int `json:"redsSafe"`
	RedsDodge int `json:"redsDodged"`
	Burns     int `json:"burns"`
	Repairs   int `json:"repairs"`
	RepairErr int `json:"repairErrors"`
	BestCombo int `json:"bestCombo"`
}

type Atrapa struct {
	cfg *Config
	rng *rand.Rand

	T, Dur, Diff float64
	Score        float64
	Combo        int
	Mode         int
	Mill         float64
	Streak       int
	Burned       bool
	Code         []string
	Step_        int
	Links        [2]float64
	Winds        []*Wind
	Stats        AtrapaStats
	Human        map[Role]bool

	gustIn, lastA, lastS float64
	nextID               int
	botRepairAt          float64
	botModeAt            float64
	botTarget            int
	events               []Event
}

func newAtrapa(cfg *Config, dur, diff float64, seed int64) *Atrapa {
	a := &Atrapa{cfg: cfg, rng: rand.New(rand.NewSource(seed)), Dur: dur, Diff: diff, Human: map[Role]bool{}, gustIn: 1.5, lastS: 1,
		Links: [2]float64{.7, .7}, Winds: []*Wind{}, Code: []string{}}
	a.Mill = a.rng.Float64() * 2 * math.Pi
	a.lastA = a.Mill
	return a
}

func (a *Atrapa) Done() bool                 { return a.T >= a.Dur }
func (a *Atrapa) Humans() map[Role]bool      { return a.Human }
func (a *Atrapa) emit(e Event)               { a.events = append(a.events, e) }
func (a *Atrapa) randf(x, y float64) float64 { return x + a.rng.Float64()*(y-x) }
func (a *Atrapa) link(i int, v float64)      { a.Links[i] += (v - a.Links[i]) * .16 }

func (a *Atrapa) Step(dt float64) {
	a.T += dt
	if a.Burned {
		a.botRepair()
		return
	}
	a.spawn(dt)
	a.bots(dt)
	a.resolve()
}

func (a *Atrapa) spawn(dt float64) {
	a.gustIn -= dt
	if a.gustIn > 0 || a.T > a.Dur-2 {
		return
	}
	p := clamp(a.T/a.Dur, 0, 1)
	gap := lerp(a.cfg.Num("atrapa.gap_inicio"), a.cfg.Num("atrapa.gap_final"), p) * a.Diff
	travel := lerp(a.cfg.Num("atrapa.viaje_inicio"), a.cfg.Num("atrapa.viaje_final"), p) * a.Diff
	lead := a.cfg.Num("atrapa.aviso")
	maxD := math.Min(170*math.Pi/180, gap*125*math.Pi/180*.62)
	if a.rng.Float64() > .66 {
		a.lastS = -a.lastS
	}
	a.lastA += a.randf(math.Min(38*math.Pi/180, maxD*.5), maxD) * a.lastS
	red := lerp(a.cfg.Num("atrapa.rojo_inicio"), a.cfg.Num("atrapa.rojo_final"), p)
	c := windVerde
	switch r := a.rng.Float64(); {
	case a.T < 6: // las primeras ráfagas son para acomodarse
	case r < red:
		c = windRojo
	case r < red+.28:
		c = windAmarillo
	}
	a.nextID++
	a.Winds = append(a.Winds, &Wind{ID: a.nextID, Angle: a.lastA, Born: a.T, Fly: a.T + lead, Arrive: a.T + lead + travel, Color: c,
		botOff: a.rng.Float64() < .15, botAt: a.T + a.randf(.8, 2)})
	a.gustIn = gap
}

func (a *Atrapa) resolve() {
	out := a.Winds[:0]
	var burn bool
	for _, w := range a.Winds {
		if a.T < w.Arrive {
			out = append(out, w)
			continue
		}
		facing := math.Abs(angDiff(a.Mill, w.Angle)) <= tolerance
		perf := math.Abs(angDiff(a.Mill, w.Angle)) <= perfect
		ev := Event{"k": "wind", "id": w.ID, "c": w.Color, "a": w.Angle, "mode": a.Mode, "facing": facing, "perfect": perf}
		base, result := 0.0, ""
		rightMode := a.Mode == w.Color
		switch w.Color {
		case windRojo:
			switch {
			case !facing:
				result, base = "dodged", 40
				a.Stats.RedsDodge++
				a.Streak = 0
				a.link(0, 1)
				if rightMode {
					a.link(1, 1)
				} else {
					a.link(1, .5)
				}
			case a.Mode == modeProteccion:
				result, base = "protected", 60
				a.Stats.RedsSafe++
				a.Streak = 0
				a.link(1, 1)
			default:
				result = "burned"
				a.Stats.RedsHit++
				a.Streak++
				a.Combo = 0
				a.Score = math.Max(0, a.Score-30)
				a.link(1, 0)
				if a.Streak >= redsToBurn {
					burn = true
				}
			}
		default:
			switch {
			case !facing:
				result = "miss"
				a.Stats.Missed++
				a.Combo = 0
				a.link(0, 0)
			case a.Mode == modeProteccion:
				result = "shielded" // con la protección puesta no entra energía
				a.Stats.WrongMode++
				a.Combo = 0
				a.link(0, 1)
				a.link(1, 0)
			case rightMode:
				result, base = "caught", 100
				if w.Color == windAmarillo {
					base = 160
				}
				if perf {
					base *= 1.3
				}
				a.Stats.Caught++
				a.Stats.RightMode++
				a.Combo++
				a.Stats.BestCombo = max(a.Stats.BestCombo, a.Combo)
				base *= 1 + math.Min(1.5, float64(a.Combo)*.1)
				a.link(0, 1)
				a.link(1, 1)
			default:
				result, base = "weak", 40
				a.Stats.Caught++
				a.Stats.WrongMode++
				a.link(0, 1)
				a.link(1, .15)
			}
		}
		a.Score += base
		ev["result"], ev["pts"], ev["combo"], ev["streak"] = result, math.Round(base), a.Combo, a.Streak
		a.emit(ev)
	}
	a.Winds = out
	if burn {
		a.burn()
	}
}

func (a *Atrapa) burn() {
	a.Burned = true
	a.Stats.Burns++
	a.Score = math.Max(0, a.Score-150)
	a.Combo = 0
	a.Step_ = 0
	a.Code = make([]string, 0, codeLen)
	for len(a.Code) < codeLen {
		s := repairSigns[a.rng.Intn(len(repairSigns))]
		// Sin repetidas seguidas: la misma seña dos veces no se distingue de sostenerla
		if len(a.Code) == 0 || a.Code[len(a.Code)-1] != s {
			a.Code = append(a.Code, s)
		}
	}
	a.Winds = a.Winds[:0]
	a.botRepairAt = a.T + 1.5
	a.emit(Event{"k": "burn"})
}

func (a *Atrapa) CmdFix(sign string) {
	if !a.Burned || a.Step_ >= len(a.Code) {
		return
	}
	if sign != a.Code[a.Step_] {
		a.Step_ = 0
		a.Stats.RepairErr++
		a.emit(Event{"k": "fixbad"})
		return
	}
	a.Step_++
	a.emit(Event{"k": "fixok", "step": a.Step_})
	if a.Step_ == len(a.Code) {
		a.Burned = false
		a.Streak = 0
		a.Stats.Repairs++
		a.Code = a.Code[:0]
		a.gustIn = 2
		a.emit(Event{"k": "repaired"})
	}
}

func (a *Atrapa) botRepair() {
	if !a.Human[RoleDirector] && a.T >= a.botRepairAt && a.Step_ < len(a.Code) {
		a.botRepairAt = a.T + 1.2
		a.CmdFix(a.Code[a.Step_])
	}
}

func (a *Atrapa) bots(dt float64) {
	var next *Wind
	for _, w := range a.Winds {
		if next == nil || w.Arrive < next.Arrive {
			next = w
		}
	}
	if !a.Human[RoleAnunciador] && next != nil && a.T >= next.botAt {
		if next.botOff {
			a.Mode = (next.Color + 1) % 3
		} else {
			a.Mode = next.Color
		}
	}
	if !a.Human[RoleDirector] && next != nil && a.T >= next.Fly-1 && !next.botOff {
		target := next.Angle
		if next.Color == windRojo && a.Mode != modeProteccion {
			target += math.Pi / 2 // esquiva
		}
		d := angDiff(target, a.Mill)
		if math.Abs(d) > 8*math.Pi/180 {
			step := math.Copysign(125*math.Pi/180*dt, d)
			if math.Abs(step) > math.Abs(d) {
				step = d
			}
			a.Mill += step
		}
	}
}

func (a *Atrapa) Command(r Role, m inMsg) {
	switch m.T {
	case "mill":
		if r == RoleDirector && !a.Burned && !math.IsNaN(m.A) && !math.IsInf(m.A, 0) {
			a.Mill = m.A
		}
	case "mode":
		if r == RoleAnunciador && m.I >= 0 && m.I <= 2 && !a.Burned {
			if a.Mode != m.I {
				a.Mode = m.I
				a.emit(Event{"k": "mode", "mode": m.I})
			}
		}
	case "fix":
		if r == RoleDirector {
			a.CmdFix(m.G)
		}
	}
}

func (a *Atrapa) Snapshot(phase Phase, count float64) map[string]any {
	links := a.capped()
	return map[string]any{"t": "s", "phase": phase, "count": count, "T": math.Round(a.T*100) / 100, "D": a.Dur, "score": math.Round(a.Score), "combo": a.Combo,
		"mode": a.Mode, "mill": a.Mill, "streak": a.Streak, "burned": a.Burned, "code": a.Code, "step": a.Step_, "links": links, "w": a.Winds, "human": a.Human, "ev": a.drain()}
}

func (a *Atrapa) drain() []Event { e := a.events; a.events = nil; return e }

func (a *Atrapa) capped() [2]float64 {
	l := a.Links
	for i, r := range atrapaRoles {
		if !a.Human[r] {
			l[i] = math.Min(l[i], botLinkCap)
		}
	}
	return l
}

func (a *Atrapa) Dash() map[string]any {
	return map[string]any{"T": math.Round(a.T), "D": a.Dur, "score": math.Round(a.Score), "links": a.capped(), "human": a.Human, "streak": a.Streak, "burned": a.Burned}
}

func (a *Atrapa) Result() map[string]any {
	return map[string]any{"score": math.Round(a.Score), "links": a.capped(), "stats": a.Stats, "timeline": []float64{}, "sync": (a.Links[0] + a.Links[1]) / 2}
}
