import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { intercompanySilemaService } from './intercompanySilema.service';

@Controller()
export class intercompanySilemaController {
  constructor(private readonly intercompanySilemaService: intercompanySilemaService) {}

  @Post('syncIntercompanySilema')
  async syncIntercompanySilema(@Body() params: any) {
    const { companyID, database, idFactura, tabla, client_id, client_secret, tenant, entorno } = params;
    let res = await this.intercompanySilemaService.syncIntercompany(companyID, database, idFactura, tabla, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los items correctamente';
    else return 'Ha habido un error al sincronizar los items';
  }
}
