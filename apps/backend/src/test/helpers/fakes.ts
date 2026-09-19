import type { OidcClient, OidcUserinfo } from '../../auth/oidc.js';
import type { PushPayload, PushService } from '../../services/push.js';
import type { Storage } from '../../services/storage.js';

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
  failForTitle: string | null = null;
  async sendToUsers(userSubs: string[], payload: PushPayload): Promise<number> {
    if (payload.title === this.failForTitle) throw new Error('push down');
    this.sent.push({ userSubs: [...userSubs].sort(), payload });
    return this.deliverCount;
  }
}

export class FakeStorage implements Storage {
  objects = new Map<string, Date>();
  put(key: string, at = new Date()): void { this.objects.set(key, at); }
  async presignPut(key: string): Promise<string> { return `https://fake-s3/${key}?op=put`; }
  async presignGet(key: string): Promise<string> { return `https://fake-s3/${key}?op=get`; }
  async exists(key: string): Promise<boolean> { return this.objects.has(key); }
  async remove(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async list(prefix: string) {
    return [...this.objects].filter(([k]) => k.startsWith(prefix)).map(([key, lastModified]) => ({ key, lastModified }));
  }
}
