import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { locationSilemaService } from './locationSilema.service';
import fs = require('fs');
// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class locationSilemaController {
  constructor(private readonly locationSilemaService: locationSilemaService) {}

  @Post('syncLocationSilema')
  async syncLocationSilema(@Body() params: any) {
    const { companyID, database, client_id, client_secret, tenant, entorno } = params;
    let res = await this.locationSilemaService.syncLocationSilema(companyID, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los contacts correctamente';
    else return 'Ha habido un error al sincronizar los contacts';
  }
}
