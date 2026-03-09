import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { peticionesMqttService } from './peticionesMqtt.service';

@Controller()
export class peticionesMqttController {
  constructor(private readonly peticionesMqttService: peticionesMqttService) { }

  @Get('syncIntercompanySilemaByDate')
  async syncIntercompanySilemaByDate(
    @Query('companyID') companyID: string,
    @Query('entorno') entorno: string,
    @Query('day') day: string,
    @Query('month') month: string,
    @Query('anio') anio: string,
    @Query('factura') factura: string,
  ) {
    let res = await this.peticionesMqttService.syncIntercompanyByDate(companyID, entorno, day, month, anio, factura);
    if (res == true) {
      return 'Petición de sincronización de facturas intercompany recibida';
    } else {
      return 'Ha habido un error al sincronizar las facturas intercompany';
    }
  }

  @Get('syncSilemaDate')
  async syncSilemaDate(
    @Query('companyID') companyID: string,
    @Query('entorno') entorno: string,
    @Query('diaInicio') diaInicio: string,
    @Query('diaFin') diaFin: string,
    @Query('mes') mes: string,
    @Query('anio') anio: string,
    @Query('turno') turno: number,
    @Query('tiendas') tiendas: string,
    @Query('empresa') empresa: string,
  ) {
    let res = await this.peticionesMqttService.syncSilemaDate(diaInicio, diaFin, mes, anio, turno, companyID, entorno, empresa, tiendas);
    if (res == true) {
      return 'Petición de sincronización de ventas y cierres recibida';
    } else {
      return 'Ha habido un error al sincronizar las ventas y cierres';
    }
  }
}