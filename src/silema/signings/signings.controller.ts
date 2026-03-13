import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { signingsService } from './signings.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class signingsController {
  constructor(private readonly signingsService: signingsService) {}

  @Post('syncsignings')
  async signings(@Body() params: any) {
    const { companyNAME, database, client_id, client_secret, tenant, entorno } = params;
    let res = await this.signingsService.syncSignings(companyNAME, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los fichajes correctamente';
    else return 'Ha habido un error al sincronizar los fichajes';
  }
}
