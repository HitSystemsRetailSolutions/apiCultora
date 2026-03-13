import { Injectable, Logger } from '@nestjs/common';
import * as sql from 'mssql';
let pool = undefined;

@Injectable()
export class runSqlService {
  private readonly logger = new Logger(runSqlService.name);

  async PoolCreation() {
    try {
      if (pool) return;
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
      this.logger.log('SQL Database pool created successfully');
    } catch (error) {
       this.logger.error('Failed to create SQL Database pool', error);
       throw error;
    }
  }

  async runSql(req: string, db: string, inputs?: { name: string, type: any, value: any }[]) {
    try {
      if (!pool) await this.PoolCreation();
      
      // Construir la petición
      const request = pool.request();
      
      // Si hay parámetros definidos de forma segura, inyectarlos
      if (inputs && inputs.length > 0) {
        for (const input of inputs) {
          request.input(input.name, input.type, input.value);
        }
      }

      const c = `use ${db}; ${req}`;
      let r = await request.query(c);
      return r;
    } catch (error) {
       this.logger.error(`Error executing SQL Query on DB ${db}: ${error.message} \n Query: ${req}`);
       // Opcional: Relanzar o devolver algo nulo para no crashear estrepitosamente la app.
       // Devolvemos el error encapsulado para que quien llama pueda decidir qué hacer sin que NestJS muera.
       return { recordset: [], error: true, details: error.message }; 
    }
  }
}
