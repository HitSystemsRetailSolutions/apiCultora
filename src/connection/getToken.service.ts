import { Injectable } from '@nestjs/common';
import axios from 'axios';
@Injectable()
export class getTokenService {

  async getToken2(client_id: string, client_secret: string, tenant: string) {
    const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
    const params = new URLSearchParams();

    params.append('tenant', tenant);
    params.append('token_type', process.env.token_type);
    params.append('grant_type', process.env.grant_type);
    params.append('client_id', client_id);
    params.append('client_secret', client_secret);
    params.append('scope', process.env.scope);
    const response = await axios.post(url, params).catch((error) => {
      throw new Error(error);
    });

    if (!response.data) {
      throw new Error('Failed to obtain access token');
    }

    return response.data.access_token;
  }
}
