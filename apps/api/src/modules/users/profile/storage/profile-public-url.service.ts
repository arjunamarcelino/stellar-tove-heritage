import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { supabaseConfig } from '@config/supabase.config';
import { profileImageConfig } from '@config/profile-image.config';

/** DI token + narrow port for building public avatar URLs without a storage client. */
export const PROFILE_PUBLIC_URL = 'PROFILE_PUBLIC_URL';
export interface IProfilePublicUrl {
  getPublicUrl(path: string): string;
}

/**
 * Builds the public (unsigned, stable) avatar URL by pure string concatenation — the same shape Supabase's
 * `getPublicUrl` returns — WITHOUT constructing a service-role storage client (TOV-30 #413). This lets the
 * read path (ProfileViewService, imported transitively by AuthModule) resolve avatar URLs without dragging
 * two `createClient(...)` singletons into AuthModule's boot graph. It is an infra adapter (not a domain
 * service), so injecting `supabaseConfig` here is acceptable.
 */
@Injectable()
export class ProfilePublicUrlService implements IProfilePublicUrl {
  private readonly base: string;

  constructor(
    @Inject(supabaseConfig.KEY) supa: ConfigType<typeof supabaseConfig>,
    @Inject(profileImageConfig.KEY) profile: ConfigType<typeof profileImageConfig>,
  ) {
    this.base = `${supa.url}/storage/v1/object/public/${profile.publicBucket}`;
  }

  getPublicUrl(path: string): string {
    return `${this.base}/${path}`;
  }
}
