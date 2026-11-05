package main

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
)

// Parámetros que se pueden cambiar en vivo desde /dev, sin redeployar.
// Solo existen estas claves y cada una tiene sus límites: ni la IA ni un humano
// pueden dejar el juego en un estado que el catálogo no contemple.
type configItem struct {
	Key     string  `json:"key"`
	Label   string  `json:"label"`
	Kind    string  `json:"kind"` // number | text
	Min     float64 `json:"min,omitempty"`
	Max     float64 `json:"max,omitempty"`
	Default any     `json:"default"`
}

var catalog = []configItem{
	{"solo.gap_inicio", "Modo solo: segundos entre ráfagas al empezar", "number", 1.5, 8, 3.6},
	{"solo.gap_final", "Modo solo: segundos entre ráfagas al final", "number", 1, 6, 1.7},
	{"solo.viaje_inicio", "Modo solo: segundos que tarda una ráfaga al empezar", "number", 2, 10, 5.4},
	{"solo.viaje_final", "Modo solo: segundos que tarda una ráfaga al final", "number", 1.5, 8, 3},
	{"solo.gana_acierto", "Modo solo: eficiencia que suma un acierto", "number", 1, 25, 7},
	{"solo.pierde_fallo", "Modo solo: eficiencia que resta un fallo", "number", 1, 40, 11},
	{"solo.giro", "Modo solo: grados por segundo que gira el molino", "number", 60, 260, 125},

	{"grupal.gap_inicio", "Grupal: segundos entre ráfagas al empezar", "number", 2, 12, 5},
	{"grupal.gap_final", "Grupal: segundos entre ráfagas al final", "number", 1.5, 8, 2.6},
	{"grupal.viaje_inicio", "Grupal: segundos que tarda una ráfaga al empezar", "number", 2, 10, 5},
	{"grupal.viaje_final", "Grupal: segundos que tarda una ráfaga al final", "number", 1.5, 8, 3.2},
	{"grupal.aviso_vigia", "Grupal: ventaja del vigía antes de que la ráfaga entre", "number", 1, 8, 3.5},
	{"grupal.niebla", "Grupal: segundos de aviso del molino si el vigía no marca", "number", 1, 6, 2.4},
	{"grupal.energia_rafaga", "Grupal: energía que da una ráfaga atrapada", "number", 3, 30, 11},
	{"grupal.flujo_max", "Grupal: energía por segundo máxima que puede soltar la red", "number", 3, 16, 7},
	{"grupal.consumo_casa", "Grupal: energía por segundo que gasta cada casa encendida", "number", .1, 2, .5},
	{"grupal.llamada_inicio", "Grupal: segundos entre casas que piden luz al empezar", "number", 1.5, 12, 4.5},
	{"grupal.llamada_final", "Grupal: segundos entre casas que piden luz al final", "number", .8, 8, 1.8},
	{"grupal.espera_pedido", "Grupal: segundos que una casa espera su luz", "number", 2, 20, 7},
	{"grupal.espera_apagar", "Grupal: segundos para apagar una casa vacía", "number", 2, 15, 5},
	{"grupal.tormenta_cada", "Grupal: segundos entre tormentas", "number", 15, 180, 42},
	{"grupal.reparacion", "Grupal: segundos que lleva reparar una línea", "number", .5, 8, 2.2},

	{"texto.bajada", "Portada: texto bajo el título", "text", 0, 220, "Noventa segundos, del amanecer a la noche. Girá el molino con las manos, atrapá cada ráfaga de frente y encendé todas las casas de la isla."},
	{"texto.grupal", "Grupal: texto de la portada", "text", 0, 220, "Cuatro roles, una sola isla. Si uno se duerme, baja el puntaje de todo el equipo."},
}

// Config guarda los valores vigentes en memoria y el historial en Postgres.
type Config struct {
	mu   sync.RWMutex
	vals map[string]any
	db   dbExecutor
}

type dbExecutor interface {
	versionsAppend(ctx context.Context, key, before, after, who, why string) error
	configLoad(ctx context.Context) (map[string]string, error)
}

func newConfig(ctx context.Context, db dbExecutor) (*Config, error) {
	c := &Config{vals: map[string]any{}, db: db}
	for _, it := range catalog {
		c.vals[it.Key] = it.Default
		// En el catálogo hay enteros y decimales: en memoria todos los números son float64
		if n, ok := it.Default.(int); ok {
			c.vals[it.Key] = float64(n)
		}
	}
	saved, err := db.configLoad(ctx)
	if err != nil {
		return nil, err
	}
	for k, raw := range saved {
		it := findItem(k)
		if it == nil {
			continue // clave retirada del catálogo
		}
		var v any
		if json.Unmarshal([]byte(raw), &v) != nil {
			continue
		}
		if clean, err := it.validate(v); err == nil {
			c.vals[k] = clean
		}
	}
	return c, nil
}

func findItem(key string) *configItem {
	for i := range catalog {
		if catalog[i].Key == key {
			return &catalog[i]
		}
	}
	return nil
}

func (it *configItem) validate(v any) (any, error) {
	switch it.Kind {
	case "number":
		f, ok := v.(float64)
		if !ok {
			return nil, fmt.Errorf("%s tiene que ser un número", it.Key)
		}
		if f < it.Min || f > it.Max {
			return nil, fmt.Errorf("%s tiene que estar entre %g y %g", it.Key, it.Min, it.Max)
		}
		return f, nil
	case "text":
		s, ok := v.(string)
		if !ok || s == "" {
			return nil, fmt.Errorf("%s tiene que ser un texto", it.Key)
		}
		if float64(len([]rune(s))) > it.Max {
			return nil, fmt.Errorf("%s admite hasta %g caracteres", it.Key, it.Max)
		}
		return s, nil
	}
	return nil, fmt.Errorf("tipo desconocido en %s", it.Key)
}

func (c *Config) Num(key string) float64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	f, _ := c.vals[key].(float64)
	return f
}

func (c *Config) All() map[string]any {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make(map[string]any, len(c.vals))
	for k, v := range c.vals {
		out[k] = v
	}
	return out
}

// Set valida, guarda en el historial y recién ahí aplica.
func (c *Config) Set(ctx context.Context, key string, val any, who, why string) (before, after any, err error) {
	it := findItem(key)
	if it == nil {
		return nil, nil, fmt.Errorf("no existe la clave %q", key)
	}
	clean, err := it.validate(val)
	if err != nil {
		return nil, nil, err
	}
	c.mu.Lock()
	before = c.vals[key]
	c.mu.Unlock()
	b, _ := json.Marshal(before)
	a, _ := json.Marshal(clean)
	if err := c.db.versionsAppend(ctx, key, string(b), string(a), who, why); err != nil {
		return nil, nil, err
	}
	c.mu.Lock()
	c.vals[key] = clean
	c.mu.Unlock()
	return before, clean, nil
}
