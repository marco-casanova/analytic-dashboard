import { Component, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { TopNavComponent } from './ui/top-nav/top-nav.component';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, TopNavComponent],
  template: '<app-top-nav *ngIf="!isLoginRoute()"></app-top-nav><router-outlet></router-outlet>',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('analytic-dashboard');
  constructor(private router: Router) {}

  isLoginRoute(): boolean {
    // Hide top nav on the login route (root path)
    const url = this.router.url.split('?')[0].split('#')[0];
    return url === '/' || url === '';
  }
}
