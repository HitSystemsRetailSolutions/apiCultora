import { Module } from '@nestjs/common';
import { runSqlService } from 'src/connection/sqlConnection.service';
import { getTokenService } from './getToken.service';

@Module({
    providers: [runSqlService, getTokenService],
    exports: [runSqlService, getTokenService],
})
export class ConnectionModule { }
