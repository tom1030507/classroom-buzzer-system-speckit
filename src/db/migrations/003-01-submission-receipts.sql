-- An opaque public identifier avoids exposing the global submission row number or order.
CREATE TABLE submission_receipts (
  submission_id INTEGER PRIMARY KEY REFERENCES submissions (id),
  receipt_id    TEXT NOT NULL UNIQUE
);

INSERT INTO submission_receipts (submission_id, receipt_id)
SELECT id, lower(hex(randomblob(16))) FROM submissions;

CREATE TRIGGER submissions_create_receipt
AFTER INSERT ON submissions
BEGIN
  INSERT INTO submission_receipts (submission_id, receipt_id)
  VALUES (NEW.id, lower(hex(randomblob(16))));
END;
