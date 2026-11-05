package main

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// El navegador recorre estas listas en cada lectura: tienen que llegar como [] aunque estén vacías.
func TestListasVaciasNoSonNull(t *testing.T) {
	s := newSim(testConfig(t), 60, 1, 1)
	b, err := json.Marshal(map[string]any{"g": s.Gusts, "st": s.Storms})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "null") {
		t.Fatalf("una lista vacía viajó como null: %s", b)
	}
	s.Gusts = []*Gust{{ID: 1, Arrive: 0, Pinged: true}}
	s.stepGusts()
	s.stepStorms()
	if b, _ = json.Marshal(s.Gusts); string(b) != "[]" {
		t.Fatalf("después de resolver la última ráfaga: %s", b)
	}
}

type memStore struct{}

func (memStore) versionsAppend(context.Context, string, string, string, string, string) error {
	return nil
}
func (memStore) configLoad(context.Context) (map[string]string, error) { return nil, nil }

func testConfig(t *testing.T) *Config {
	t.Helper()
	c, err := newConfig(context.Background(), memStore{})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func run(s *Sim, each func()) {
	for !s.Done() {
		if each != nil {
			each()
		}
		s.Step(.05)
	}
}

// Una persona perfecta en cada rol, para medir el techo del juego.
func playPerfect(s *Sim) {
	for _, r := range allRoles {
		s.Human[r] = true
	}
	run(s, func() {
		for _, g := range s.Gusts {
			s.CmdPing(g.ID)
		}
		for _, st := range s.Storms {
			s.CmdWarn(st.ID)
			s.CmdProtect(st.ID)
		}
		var next *Gust
		for _, g := range s.Gusts {
			if next == nil || g.Arrive < next.Arrive {
				next = g
			}
		}
		if next != nil {
			s.CmdMill(next.Angle)
		}
		s.CmdFlow((s.Demand*1.2 + .3) / s.cfg.Num("grupal.flujo_max"))
		for i := range s.Dists {
			s.CmdReset(i)
			s.CmdRepair(i, true)
		}
		for i := range s.Houses {
			if st := s.Houses[i].State; st == houseWants || st == houseLeaving || st == houseWasting {
				s.CmdHouse(i)
			}
		}
	})
}

func TestBotsTerminan(t *testing.T) {
	s := newSim(testConfig(t), 180, 1, 7)
	run(s, nil)
	if s.Score <= 0 || s.Stats.Hits == 0 || s.Stats.Served == 0 {
		t.Fatalf("una partida de bots debería sumar: %+v score=%v", s.Stats, s.Score)
	}
	for i, l := range s.Links {
		if l > botLinkCap+1e-9 {
			t.Errorf("eslabón %d de bot pasó el tope: %v", i, l)
		}
	}
}

func TestEquipoPerfectoGanaMasQueBots(t *testing.T) {
	for seed := int64(1); seed <= 4; seed++ {
		cfg := testConfig(t)
		a := newSim(cfg, 180, 1, seed)
		run(a, nil)
		b := newSim(cfg, 180, 1, seed)
		playPerfect(b)
		if b.Score < a.Score*1.5 {
			t.Errorf("semilla %d: perfecto %v vs bots %v", seed, b.Score, a.Score)
		}
		if b.Stats.Misses != 0 || b.Stats.Unserved != 0 {
			t.Errorf("semilla %d: el equipo perfecto no debería fallar: %+v", seed, b.Stats)
		}
		if b.Stats.DarkSecs > 15 {
			t.Errorf("semilla %d: con juego perfecto no debería quedarse sin batería tanto tiempo: %v s", seed, b.Stats.DarkSecs)
		}
		t.Logf("semilla %d: bots=%.0f sync=%.2f | perfecto=%.0f sync=%.2f hits=%d served=%d bat=%.0f oscuro=%.0fs",
			seed, a.Score, a.Stats.SyncAvg, b.Score, b.Stats.SyncAvg, b.Stats.Hits, b.Stats.Served, b.Battery, b.Stats.DarkSecs)
	}
}

// Si una sola persona deja de jugar, baja el puntaje de todo el equipo.
func TestEslabonDebilBajaATodos(t *testing.T) {
	cfg := testConfig(t)
	full := newSim(cfg, 180, 1, 3)
	playPerfect(full)

	weak := newSim(cfg, 180, 1, 3)
	for _, r := range allRoles {
		weak.Human[r] = true
	}
	run(weak, func() {
		for _, g := range weak.Gusts {
			weak.CmdPing(g.ID)
		}
		var next *Gust
		for _, g := range weak.Gusts {
			if next == nil || g.Arrive < next.Arrive {
				next = g
			}
		}
		if next != nil {
			weak.CmdMill(next.Angle)
		}
		weak.CmdFlow((weak.Demand*1.2 + .3) / weak.cfg.Num("grupal.flujo_max"))
		// Quien maneja las luces no hace nada
	})
	if weak.Score > full.Score*.5 {
		t.Fatalf("un eslabón caído debería costar mucho: %v vs %v", weak.Score, full.Score)
	}
}

func TestFlujoExcesivoQuemaFusible(t *testing.T) {
	s := newSim(testConfig(t), 60, 1, 5)
	s.Human[RoleRed] = true
	s.Battery = 100
	for s.T < 20 {
		s.Battery = 100
		s.CmdFlow(1)
		s.Step(.05)
	}
	if s.Stats.Trips == 0 {
		t.Fatal("soltar toda la energía sin demanda debería quemar un fusible")
	}
}

func TestSinFlujoNoHayLuz(t *testing.T) {
	s := newSim(testConfig(t), 60, 1, 5)
	s.Human[RoleRed] = true
	s.CmdFlow(0)
	s.Houses[0] = House{State: houseOn, Deadline: 1000}
	s.Step(.05)
	if s.Power != 0 {
		t.Fatalf("sin flujo la energía entregada debería ser 0, fue %v", s.Power)
	}
}

func TestToleranciaDelMolino(t *testing.T) {
	cfg := testConfig(t)
	for _, c := range []struct {
		off float64
		hit bool
	}{{0, true}, {24, true}, {26, false}, {180, false}} {
		s := newSim(cfg, 60, 1, 1)
		s.Human[RoleMolino] = true
		s.Gusts = []*Gust{{ID: 1, Angle: 1, Arrive: 0, Pinged: true}}
		s.CmdMill(1 + c.off*math.Pi/180)
		s.stepGusts()
		if got := s.Stats.Hits == 1; got != c.hit {
			t.Errorf("desvío %v°: acierto=%v, se esperaba %v", c.off, got, c.hit)
		}
	}
}

func TestComandoInvalidoNoRompe(t *testing.T) {
	s := newSim(testConfig(t), 60, 1, 1)
	s.CmdHouse(-1)
	s.CmdHouse(99)
	s.CmdReset(9)
	s.CmdRepair(-3, true)
	s.CmdMill(math.NaN())
	s.CmdFlow(math.Inf(1))
	if math.IsNaN(s.Mill) || s.Flow > 1 {
		t.Fatalf("estado inválido: mill=%v flow=%v", s.Mill, s.Flow)
	}
}
