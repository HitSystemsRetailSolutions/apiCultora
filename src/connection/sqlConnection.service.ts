import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
let pool = undefined;

@Injectable()
export class runSqlService {
  async PoolCreation() {
    const config = {
      user: process.env.user,
      password: process.env.password,
      server: process.env.server,
      database: 'hit',
      options: {
        encrypt: false,
        trustServerCertificate: true,
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 125000,
      },
      requestTimeout: 120000,
    };
    pool = await new sql.ConnectionPool(config).connect();
  }

  async runSql(req: string, db: string) {
    if (!pool) await this.PoolCreation();
    const c = `use ${db}; ${req}`;
    let r = await pool.request().query(c);
    return r;
  }
}
