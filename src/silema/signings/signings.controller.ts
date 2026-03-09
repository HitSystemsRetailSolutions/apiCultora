import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { signingsService } from './signings.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class signingsController {
  constructor(private readonly signingsService: signingsService) {}

  @Get('syncsignings')
  async signings(
    @Query('companyNAME') comapanyNAME: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.signingsService.syncSignings(comapanyNAME, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los fichajes correctamente';
    else return 'Ha habido un error al sincronizar los fichajes';
  }
}
