import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { salesSilemaAbonoService } from './salesSilemaAbono.service';
import fs = require('fs');
// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class salesSilemaAbonoController {
  constructor(private readonly salesSilemaAbonoService: salesSilemaAbonoService) {}

  @Post('syncSalesSilemaAbono')
  async salesSilemaAbono(@Body() params: any) {
    const { day, month, year, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno } = params;
    let res = await this.salesSilemaAbonoService.syncSalesSilemaAbono(day, month, year, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }
}
