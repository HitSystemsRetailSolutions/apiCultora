import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConnectionModule } from './connection/connection.module';
import { HelpersModule } from './helpers/helpers.module';
import { InvoicesSilemaModule } from './silema/invoices/invoicesSilema.module';
import { MaestrosSilemaModule } from './silema/maestros/maestrosSilema.module';
import { CircuitoTiendasModule } from './silema/circuitoTiendas/circuitoTiendas.module';
import { SigningsModule } from './silema/signings/signings.module';
import { TrabajadoresModule } from './silema/trabajadores/trabajadores.module';
import { PeticionesMqttModule } from './webPeticionesMqtt/peticionesMqtt.module';


@Module({
  imports: [ConfigModule.forRoot(),
    ConnectionModule,
    HelpersModule,
    InvoicesSilemaModule,
    MaestrosSilemaModule,
    CircuitoTiendasModule,
    SigningsModule,
    TrabajadoresModule,
    PeticionesMqttModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule { }
