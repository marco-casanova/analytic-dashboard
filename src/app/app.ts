import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TopNavComponent } from './ui/top-nav/top-nav.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TopNavComponent],
  template: '<app-top-nav></app-top-nav><router-outlet></router-outlet>',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('analytic-dashboard');
}
