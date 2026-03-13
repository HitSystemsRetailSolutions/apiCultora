import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { salesSilemaCierreService } from './salesSilemaCierre.service';
import fs = require('fs');
// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class salesSilemaCierreController {
  constructor(private readonly salesSilemaCierreService: salesSilemaCierreService) {}

  @Post('syncSalesSilemaCierre')
  async syncSalesSilemaCierre(@Body() params: any) {
    const { day, month, year, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno } = params;
    let res = await this.salesSilemaCierreService.syncSalesSilemaCierre(day, month, year, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }
}
