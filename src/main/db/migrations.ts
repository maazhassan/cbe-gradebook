// Versioned, forward-only migrations. NEVER edit a released migration; append a new one.
// The schema version is stored in SQLite's `PRAGMA user_version`.
// All pending migrations run in ONE transaction, so a failure leaves the database untouched.
// (Do not put PRAGMA foreign_keys or BEGIN/COMMIT in migration SQL.)

export interface Migration {
  version: number
  name: string
  sql: string
}

const initialSchema = `
CREATE TABLE subjects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE stems (
  id INTEGER PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  name TEXT NOT NULL COLLATE NOCASE,
  display_order INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (subject_id, name)
);

CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL CHECK (length(trim(first_name)) > 0),
  last_name TEXT NOT NULL CHECK (length(trim(last_name)) > 0),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  positive_comment_1 TEXT NOT NULL DEFAULT '',
  positive_comment_2 TEXT NOT NULL DEFAULT '',
  growth_comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE courses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE course_enrollments (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (student_id, course_id)
);
CREATE INDEX idx_enrollments_course ON course_enrollments(course_id);

CREATE TABLE assignments (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  max_points REAL NOT NULL CHECK (max_points > 0),
  weight INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 1 AND typeof(weight) = 'integer'),
  sort_order INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_assignments_course ON assignments(course_id);

CREATE TABLE assignment_stems (
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
  stem_id INTEGER NOT NULL REFERENCES stems(id) ON DELETE RESTRICT,
  PRIMARY KEY (assignment_id, stem_id)
);

-- Only the raw score is stored. A blank score is the absence of a row.
CREATE TABLE grades (
  id INTEGER PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  raw_score REAL NOT NULL CHECK (raw_score >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (assignment_id, student_id)
);
CREATE INDEX idx_grades_student ON grades(student_id);

-- Cross-table rules that CHECK constraints cannot express.
CREATE TRIGGER grades_validate_insert BEFORE INSERT ON grades
BEGIN
  SELECT RAISE(ABORT, 'Score cannot be more than the assignment maximum')
    FROM assignments a WHERE a.id = NEW.assignment_id AND NEW.raw_score > a.max_points;
  SELECT RAISE(ABORT, 'Student is not enrolled in the assignment''s course')
    WHERE NOT EXISTS (
      SELECT 1 FROM assignments a JOIN course_enrollments e ON e.course_id = a.course_id
      WHERE a.id = NEW.assignment_id AND e.student_id = NEW.student_id);
END;

CREATE TRIGGER grades_validate_update BEFORE UPDATE ON grades
BEGIN
  SELECT RAISE(ABORT, 'Score cannot be more than the assignment maximum')
    FROM assignments a WHERE a.id = NEW.assignment_id AND NEW.raw_score > a.max_points;
  SELECT RAISE(ABORT, 'Student is not enrolled in the assignment''s course')
    WHERE NOT EXISTS (
      SELECT 1 FROM assignments a JOIN course_enrollments e ON e.course_id = a.course_id
      WHERE a.id = NEW.assignment_id AND e.student_id = NEW.student_id);
END;

CREATE TRIGGER assignments_max_points_guard BEFORE UPDATE OF max_points ON assignments
BEGIN
  SELECT RAISE(ABORT, 'Existing scores are higher than the new maximum points')
    WHERE EXISTS (SELECT 1 FROM grades g WHERE g.assignment_id = NEW.id AND g.raw_score > NEW.max_points);
END;

CREATE TRIGGER assignments_course_immutable BEFORE UPDATE OF course_id ON assignments
BEGIN
  SELECT RAISE(ABORT, 'An assignment cannot move to another course');
END;

CREATE TRIGGER courses_subject_immutable BEFORE UPDATE OF subject_id ON courses
BEGIN
  SELECT RAISE(ABORT, 'A course''s subject cannot be changed');
END;

CREATE TRIGGER stems_subject_immutable BEFORE UPDATE OF subject_id ON stems
BEGIN
  SELECT RAISE(ABORT, 'A stem cannot move to another subject');
END;

CREATE TRIGGER assignment_stems_subject_check BEFORE INSERT ON assignment_stems
BEGIN
  SELECT RAISE(ABORT, 'Stem does not belong to the course''s subject')
    WHERE NOT EXISTS (
      SELECT 1 FROM assignments a
      JOIN courses c ON c.id = a.course_id
      JOIN stems s ON s.id = NEW.stem_id
      WHERE a.id = NEW.assignment_id AND s.subject_id = c.subject_id);
END;

-- Seed data (editable later in Settings).
INSERT INTO subjects (id, name) VALUES (1, 'ELA'), (2, 'Social Studies');
INSERT INTO stems (subject_id, name, display_order) VALUES
  (1, 'Reads', 1), (1, 'Writes', 2), (1, 'Manages', 3), (1, 'Speaks', 4), (1, 'Listens', 5), (1, 'Represents', 6),
  (2, 'Understands', 1), (2, 'Explores', 2), (2, 'Inquires', 3), (2, 'Communicates', 4);
`

// Missing/exempt marks are rows with a non-'scored' status. raw_score stays NOT NULL and is stored as 0 for them
// (ignored on read), so the existing score triggers and the table definition need no rebuild.
const gradeStatus = `
ALTER TABLE grades ADD COLUMN status TEXT NOT NULL DEFAULT 'scored' CHECK (status IN ('scored', 'missing', 'exempt'));
`

// Existing assignments are backfilled with the date this migration was written (2026-10-24).
// New assignments must supply a date (enforced by the service); the default only exists for ALTER TABLE.
const assignmentDueDate = `
ALTER TABLE assignments ADD COLUMN due_date TEXT NOT NULL DEFAULT '2026-10-24'
  CHECK (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
`

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial schema and seed data', sql: initialSchema },
  { version: 2, name: 'missing and exempt grade statuses', sql: gradeStatus },
  { version: 3, name: 'assignment due dates', sql: assignmentDueDate }
]
