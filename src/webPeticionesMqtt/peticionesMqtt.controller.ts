import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { peticionesMqttService } from './peticionesMqtt.service';

@Controller()
export class peticionesMqttController {
  constructor(private readonly peticionesMqttService: peticionesMqttService) { }

  @Post('syncIntercompanySilemaByDate')
  async syncIntercompanySilemaByDate(@Body() params: any) {
    const { companyID, entorno, day, month, anio, factura } = params;
    let res = await this.peticionesMqttService.syncIntercompanyByDate(companyID, entorno, day, month, anio, factura);
    if (res == true) return 'Petición de sincronización de facturas intercompany recibida';
    else return 'Ha habido un error al sincronizar las facturas intercompany';
  }

  @Post('syncSilemaDate')
  async syncSilemaDate(@Body() params: any) {
    const { diaInicio, diaFin, mes, anio, turno, companyID, entorno, empresa, tiendas } = params;
    let res = await this.peticionesMqttService.syncSilemaDate(diaInicio, diaFin, mes, anio, turno, companyID, entorno, empresa, tiendas);
    if (res == true) return 'Petición de sincronización de ventas y cierres recibida';
    else return 'Ha habido un error al sincronizar las ventas y cierres';
  }

  @Post('cronIntercompanySync')
  async cronIntercompanySync(@Body() params: any) {
    let res = await this.peticionesMqttService.cronIntercompanySync(params);
    if (res == true) return 'Proceso de revisión Intercompany finalizado';
    else return 'Error en el proceso de revisión Intercompany';
  }
}