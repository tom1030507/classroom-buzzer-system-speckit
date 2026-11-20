-- 004-01-backfill-speed-results.sql
-- SF-04：補齊本功能上線前已結束、但沒有保存結果的速度模式活動
-- （specs/004-results-export/research.md R12）。
-- 規則與結束時相同：每個單位依伺服器受理序號排名，第 1 名勝出。
-- 受理紀錄不可修改，補寫的結果與當時應保存的結果一致。公平模式無法在此補算，維持沒有結果。
INSERT INTO results (submission_id, unit_id, final_rank, is_winner)
SELECT id, unit_id, final_rank, final_rank = 1
FROM (
  SELECT s.id, s.unit_id,
         ROW_NUMBER() OVER (PARTITION BY s.unit_id ORDER BY s.accept_seq) AS final_rank
  FROM submissions AS s
  JOIN activities AS a ON a.id = s.activity_id
  WHERE a.status = 'CLOSED' AND a.mode = 'SPEED'
    AND NOT EXISTS (
      SELECT 1
      FROM results AS r
      JOIN submissions AS ranked ON ranked.id = r.submission_id
      WHERE ranked.activity_id = a.id
    )
);
