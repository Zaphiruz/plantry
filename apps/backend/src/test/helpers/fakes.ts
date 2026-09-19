import type { OidcClient, OidcUserinfo } from '../../auth/oidc.js';
import type { PushPayload, PushService } from '../../services/push.js';

export class FakeOidcClient implements OidcClient {
  userinfo: OidcUserinfo = { sub: 'sub-0', email: 'fake@example.com', name: 'Fake', groups: [], idToken: 'idt' };
  authorizationUrl() {
    return { url: 'https://auth.example/authorize', state: 'state-0', nonce: 'nonce-0', codeVerifier: 'cv-0' };
  }
  async exchange() { return this.userinfo; }
  endSessionUrl() { return 'https://auth.example/logout'; }
}

export class FakePush implements PushService {
  publicKey = 'fake-vapid-public-key';
  sent: { userSubs: string[]; payload: PushPayload }[] = [];
  deliverCount = 1;
  async sendToUsers(userSubs: string[], payload: PushPayload): Promise<number> {
    this.sent.push({ userSubs: [...userSubs].sort(), payload });
    return this.deliverCount;
  }
}
