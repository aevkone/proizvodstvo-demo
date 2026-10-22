// Совместимый с node:sqlite интерфейс DatabaseSync поверх sql.js (SQLite в WebAssembly)

let SQL = null;
let pendingBytes = null;

export function setSqlJs(sql, bytes) {
  SQL = sql;
  pendingBytes = bytes || null;
}

const norm = (args) => args.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

export class DatabaseSync {
  constructor() {
    this.db = pendingBytes ? new SQL.Database(pendingBytes) : new SQL.Database();
    pendingBytes = null;
  }
  exec(sql) {
    this.db.exec(sql);
  }
  prepare(sql) {
    const db = this.db;
    const rows = (args) => {
      const st = db.prepare(sql);
      try {
        st.bind(norm(args));
        const out = [];
        while (st.step()) out.push(st.getAsObject());
        return out;
      } finally {
        st.free();
      }
    };
    return {
      run: (...args) => {
        db.run(sql, norm(args));
        const changes = db.getRowsModified();
        const id = db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0] ?? 0;
        return { changes, lastInsertRowid: id };
      },
      get: (...args) => rows(args)[0],
      all: (...args) => rows(args),
    };
  }
  export() {
    return this.db.export();
  }
}
