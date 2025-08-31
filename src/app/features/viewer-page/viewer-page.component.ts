import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ThreeCanvasComponent } from '../../ui-three/three-canvas.component';

@Component({
  selector: 'viewer-page',
  standalone: true,
  imports: [ThreeCanvasComponent],
  templateUrl: './viewer-page.component.html',
  styleUrls: ['./viewer-page.component.scss'],
})
export class ViewerPageComponent {
  constructor(private router: Router) {}

  logout() {
    try {
      localStorage.removeItem('auth');
    } catch {}
    this.router.navigateByUrl('/');
  }
}
