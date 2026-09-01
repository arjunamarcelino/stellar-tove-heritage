import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { JwtPayload } from '@common/interfaces/jwt-payload.interface';

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    return data ? user[data] : user;
  },
);
