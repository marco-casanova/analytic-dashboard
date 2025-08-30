import { Component } from '@angular/core';
import { ThreeCanvasComponent } from '../../ui-three/three-canvas.component';

@Component({
  selector: 'viewer-page',
  standalone: true,
  imports: [ThreeCanvasComponent],
  templateUrl: './viewer-page.component.html',
})
export class ViewerPageComponent {}
