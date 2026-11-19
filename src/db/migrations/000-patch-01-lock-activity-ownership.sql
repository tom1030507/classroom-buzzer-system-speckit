-- 000-patch-01-lock-activity-ownership.sql
-- 修正 PR #23 review：000-base-schema.sql 的 UPDATE trigger 只檢查 OLD.activity_id，
-- 因此可以把準備中活動的題目、單位或組別改屬已開啟的活動，繞過開啟後的鎖定與只限準備中加入的規則。
-- 這些資料列一律不得改屬其他活動；重新匯入是刪除後重建，不需要搬移。

CREATE TRIGGER units_activity_fixed
BEFORE UPDATE OF activity_id ON units
WHEN NEW.activity_id IS NOT OLD.activity_id
BEGIN
  SELECT RAISE(ABORT, 'units cannot move to another activity');
END;

CREATE TRIGGER questions_activity_fixed
BEFORE UPDATE OF activity_id ON questions
WHEN NEW.activity_id IS NOT OLD.activity_id
BEGIN
  SELECT RAISE(ABORT, 'questions cannot move to another activity');
END;

CREATE TRIGGER student_groups_activity_fixed
BEFORE UPDATE OF activity_id ON student_groups
WHEN NEW.activity_id IS NOT OLD.activity_id
BEGIN
  SELECT RAISE(ABORT, 'groups cannot move to another activity');
END;
