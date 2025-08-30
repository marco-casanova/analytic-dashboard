import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { HeartStore } from '../../state/heart.store';

@Component({
  selector: 'app-top-nav',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './top-nav.component.html',
  styleUrls: ['./top-nav.component.scss'],
})
export class TopNavComponent {
  readonly store = inject(HeartStore);
  readonly patients = this.store.patients;
  readonly selectedId = this.store.selectedId;
  readonly showOverlay = this.store.showOverlay;

  onSelect(id: string) {
    if (id) this.store.select(id);
  }
}
