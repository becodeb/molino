package main

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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

CREATE TABLE IF NOT EXISTS team_results (
	id         BIGSERIAL PRIMARY KEY,
	code       TEXT        NOT NULL,
	kind       TEXT        NOT NULL,
	difficulty TEXT        NOT NULL,
	duration   INTEGER     NOT NULL,
	team_name  TEXT        NOT NULL,
	score      INTEGER     NOT NULL,
	sync_avg   REAL        NOT NULL,
	members    JSONB       NOT NULL,
	stats      JSONB       NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_results_rank_idx ON team_results (score DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS config_current (
	key        TEXT PRIMARY KEY,
	value      JSONB       NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS config_versions (
	id         BIGSERIAL PRIMARY KEY,
	key        TEXT        NOT NULL,
	before     JSONB       NOT NULL,
	after      JSONB       NOT NULL,
	who        TEXT        NOT NULL,
	why        TEXT        NOT NULL DEFAULT '',
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dev_requests (
	id         BIGSERIAL PRIMARY KEY,
	title      TEXT        NOT NULL,
	detail     TEXT        NOT NULL,
	done       BOOLEAN     NOT NULL DEFAULT false,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`

type Store struct{ db *pgxpool.Pool }

func connect(ctx context.Context, url string) (*Store, error) {
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
				if _, err := pool.Exec(ctx, schema, pgx.QueryExecModeSimpleProtocol); err != nil {
					pool.Close()
					return nil, err
				}
				return &Store{db: pool}, nil
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

/* ---------- Ranking individual ---------- */

type entry struct {
	Rank       int    `json:"rank"`
	Name       string `json:"name"`
	Score      int    `json:"score"`
	Hits       int    `json:"hits"`
	Misses     int    `json:"misses"`
	BestCombo  int    `json:"bestCombo"`
	Efficiency int    `json:"efficiency"`
}

func (s *Store) topScores(ctx context.Context) ([]entry, error) {
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

func (s *Store) addScore(ctx context.Context, sub submission) (rank int, err error) {
	var id int64
	if err = s.db.QueryRow(ctx, `
		INSERT INTO scores (name, score, hits, misses, best_combo, efficiency)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		sub.Name, sub.Score, sub.Hits, sub.Misses, sub.BestCombo, sub.Efficiency).Scan(&id); err != nil {
		return 0, err
	}
	err = s.db.QueryRow(ctx, `SELECT count(*) + 1 FROM scores WHERE score > $1 OR (score = $1 AND id < $2)`, sub.Score, id).Scan(&rank)
	return rank, err
}

/* ---------- Ranking de equipos ---------- */

func (s *Store) saveTeam(ctx context.Context, code, kind, diff string, dur float64, r map[string]any) error {
	stats := r["stats"].(Stats)
	members, _ := json.Marshal(r["members"])
	st, _ := json.Marshal(stats)
	_, err := s.db.Exec(ctx, `
		INSERT INTO team_results (code, kind, difficulty, duration, team_name, score, sync_avg, members, stats)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, code, kind, diff, int(dur), r["name"], int(r["score"].(float64)), stats.SyncAvg, members, st)
	return err
}

type teamRow struct {
	Name    string          `json:"name"`
	Score   int             `json:"score"`
	Sync    float32         `json:"sync"`
	Members json.RawMessage `json:"members"`
	Diff    string          `json:"difficulty"`
}

func (s *Store) topTeams(ctx context.Context) ([]teamRow, error) {
	rows, err := s.db.Query(ctx, `
		SELECT team_name, score, sync_avg, members, difficulty
		FROM team_results ORDER BY score DESC, created_at ASC LIMIT $1`, topLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]teamRow, 0, topLimit)
	for rows.Next() {
		var t teamRow
		var m []byte
		if err := rows.Scan(&t.Name, &t.Score, &t.Sync, &m, &t.Diff); err != nil {
			return nil, err
		}
		t.Members = m
		list = append(list, t)
	}
	return list, rows.Err()
}

/* ---------- Configuración en vivo ---------- */

func (s *Store) configLoad(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.Query(ctx, `SELECT key, value::text FROM config_current`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

func (s *Store) versionsAppend(ctx context.Context, key, before, after, who, why string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `INSERT INTO config_versions (key, before, after, who, why) VALUES ($1,$2::jsonb,$3::jsonb,$4,$5)`, key, before, after, who, why); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO config_current (key, value, updated_at) VALUES ($1,$2::jsonb,now())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, key, after); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type versionRow struct {
	ID     int64           `json:"id"`
	Key    string          `json:"key"`
	Before json.RawMessage `json:"before"`
	After  json.RawMessage `json:"after"`
	Who    string          `json:"who"`
	Why    string          `json:"why"`
	When   time.Time       `json:"when"`
}

func (s *Store) versions(ctx context.Context) ([]versionRow, error) {
	rows, err := s.db.Query(ctx, `SELECT id, key, before::text, after::text, who, why, created_at FROM config_versions ORDER BY id DESC LIMIT 30`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []versionRow{}
	for rows.Next() {
		var v versionRow
		var b, a string
		if err := rows.Scan(&v.ID, &v.Key, &b, &a, &v.Who, &v.Why, &v.When); err != nil {
			return nil, err
		}
		v.Before, v.After = json.RawMessage(b), json.RawMessage(a)
		list = append(list, v)
	}
	return list, rows.Err()
}

func (s *Store) versionByID(ctx context.Context, id int64) (key string, before any, err error) {
	var b string
	if err = s.db.QueryRow(ctx, `SELECT key, before::text FROM config_versions WHERE id = $1`, id).Scan(&key, &b); err != nil {
		return "", nil, err
	}
	err = json.Unmarshal([]byte(b), &before)
	return key, before, err
}

/* ---------- Pedidos para el equipo de desarrollo ---------- */

type requestRow struct {
	ID     int64     `json:"id"`
	Title  string    `json:"title"`
	Detail string    `json:"detail"`
	Done   bool      `json:"done"`
	When   time.Time `json:"when"`
}

func (s *Store) addRequest(ctx context.Context, title, detail string) error {
	_, err := s.db.Exec(ctx, `INSERT INTO dev_requests (title, detail) VALUES ($1,$2)`, title, detail)
	return err
}

func (s *Store) requests(ctx context.Context) ([]requestRow, error) {
	rows, err := s.db.Query(ctx, `SELECT id, title, detail, done, created_at FROM dev_requests ORDER BY done ASC, id DESC LIMIT 40`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []requestRow{}
	for rows.Next() {
		var r requestRow
		if err := rows.Scan(&r.ID, &r.Title, &r.Detail, &r.Done, &r.When); err != nil {
			return nil, err
		}
		list = append(list, r)
	}
	return list, rows.Err()
}

func (s *Store) setRequestDone(ctx context.Context, id int64, done bool) error {
	_, err := s.db.Exec(ctx, `UPDATE dev_requests SET done = $2 WHERE id = $1`, id, done)
	return err
}
