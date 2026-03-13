import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { salesSilemaRecapManualService } from './salesSilemaRecapManual.service';

@Controller()
export class salesSilemaRecapManualController {
  constructor(private readonly salesSilemaRecapManualService: salesSilemaRecapManualService) { }

  @Post('syncSalesSilemaRecapManual')
  async salesSilemaRecapManual(@Body() params: any) {
    const { idFactura, tabla, companyID, database, client_id, client_secret, tenant, entorno } = params;
    let res = await this.salesSilemaRecapManualService.getDatosSalesSilemaRecapitulativaManual(idFactura, tabla, companyID, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }
}
