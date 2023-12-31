import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, Observable, of, switchMap } from 'rxjs';
import { Role } from '@app/shared/models/enum';
import { ROLES_KEY } from '../../../../apps/auth/src/decorator/roles.decorator';
import { ClientProxy } from '@nestjs/microservices';
import { UserJwt } from '@app/shared/interfaces/service-interface/user-jwt.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Inject('AUTH_SERVICE') private readonly authService: ClientProxy,
  ) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    const CLIENT_ID = 'x-client-id';

    const userId = request.headers[CLIENT_ID];
    if (!userId) return false;

    if (!authHeader) return false;

    const authHeaderParts = authHeader.split(' ');

    if (authHeaderParts.length !== 2) return false;
    const [, jwt] = authHeaderParts;

    return this.authService
      .send({ cmd: 'verify-jwt' }, { jwt, userId: userId })
      .pipe(
        switchMap((decode) => {
          //complete observable and create new one
          // console.log('ROLES',decode.data.role)
          return of(
            requiredRoles.some((role) => decode.data.role?.includes(role)),
          );
        }),
        catchError(() => {
          throw new UnauthorizedException();
        }),
      );
  }
}
