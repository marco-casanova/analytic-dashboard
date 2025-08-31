import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

function isAuthed(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('auth') === '1';
  } catch {
    return false;
  }
}

export const authGuard: CanActivateFn = (): boolean | UrlTree => {
  const router = inject(Router);
  if (isAuthed()) return true;
  return router.parseUrl('/');
};
