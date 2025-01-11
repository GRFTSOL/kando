//////////////////////////////////////////////////////////////////////////////////////////
//   _  _ ____ _  _ ___  ____                                                           //
//   |_/  |__| |\ | |  \ |  |    This file belongs to Kando, the cross-platform         //
//   | \_ |  | | \| |__/ |__|    pie menu. Read more on github.com/menu/kando           //
//                                                                                      //
//////////////////////////////////////////////////////////////////////////////////////////

// SPDX-FileCopyrightText: Simon Schneegans <code@simonschneegans.de>
// SPDX-License-Identifier: MIT

import { EventEmitter } from 'events';

import * as math from '../../common/math';
import { IDraggable } from './draggable';
import { IDropTarget } from './drop-target';

/**
 * This is the threshold in pixels which is used to differentiate between a click and a
 * drag.
 */
const DRAG_THRESHOLD = 5;

/**
 * This class is used to manage drag and drop operations in the settings. In Kando, there
 * is only one instance of this class which is created in the `Settings` class. It is used
 * to register drop targets and draggables. It will listen to pointer and touch events and
 * call the appropriate methods on the registered draggables and drop targets.
 *
 * The DnDManager is also an `EventEmitter` and emits the following events:
 *
 * @fires drag-start - When any drag operation starts. This can be used to highlight
 *   potential drop targets.
 * @fires drag-end - When any drag operation ends. This can be used to remove highlights
 *   from drop targets.
 */
export class DnDManager extends EventEmitter {
  /** This set contains all registered drop targets. */
  private dropTargets: Set<IDropTarget> = new Set();

  /**
   * This map is used to store the abort controllers for all registered draggables. The
   * abort controllers are used to cancel the event listeners when a draggable is
   * unregistered.
   */
  private draggables: Map<IDraggable, AbortController> = new Map();

  /**
   * At a given time, there can be only one drag operation. These members store the
   * current drop target and the currently dragged draggable.
   */
  private currentDropTarget?: IDropTarget = null;
  private currentlyDragged?: IDraggable = null;

  /**
   * This method is used to register a drop target. The drop target will be notified when
   * a draggable is dragged over it.
   *
   * @param target The drop target to register.
   */
  public registerDropTarget(target: IDropTarget) {
    this.dropTargets.add(target);
  }

  /**
   * Adds a draggable to the manager. The draggable will be notified when it is dragged.
   *
   * @param draggable The draggable to register.
   */
  public registerDraggable(draggable: IDraggable) {
    // This is called both for mouse and touch events. After the pointer is down, we need
    // to listen to move events to detect a drag operation. If the pointer is moved more
    // than a few pixels, we start a drag operation. If the pointer is released before
    // that, we call the `onClick` method of the draggable.
    const onPointerDown = (e: PointerEvent | TouchEvent) => {
      const dragStart = this.getCoords(e);
      const div = draggable.getDiv();
      const rect = div.getBoundingClientRect();
      const parentRect = div.parentElement.getBoundingClientRect();

      const startPos = {
        x: rect.left - parentRect.left,
        y: rect.top - parentRect.top,
      };

      const grabOffset = {
        x: dragStart.x - rect.left,
        y: dragStart.y - rect.top,
      };

      draggable.onMouseDown();

      // Start listening to move events. If the pointer is moved more than a few pixels,
      // we start a drag operation.
      const onMotionEvent = (e2: MouseEvent | TouchEvent) => {
        const viewportCoords = this.getCoords(e2);
        const offset = math.subtract(viewportCoords, dragStart);

        if (math.getLength(offset) > DRAG_THRESHOLD) {
          // If we are not already dragging something, we start a new drag operation.
          if (this.currentlyDragged === null) {
            this.currentlyDragged = draggable;
            draggable.onDragStart();
            this.emit('drag-start', draggable);
          }

          // Update the pointer graphic. If the Ctrl key is pressed, we show a copy
          // cursor, otherwise we show a move cursor.
          if (this.currentlyDragged) {
            document.body.style.cursor = e2.ctrlKey || e2.metaKey ? 'copy' : 'grabbing';
          }

          // Notify the draggable about the current position.
          draggable.onDragMove(viewportCoords, math.add(startPos, offset), grabOffset);

          // Check if the draggable is currently over a drop target.
          for (const target of this.dropTargets) {
            if (target.accepts(draggable, viewportCoords)) {
              // If the draggable is over a new drop target, we notify the old one that
              // the draggable left and the new one that the draggable entered.
              if (this.currentDropTarget !== target) {
                if (this.currentDropTarget) {
                  this.currentDropTarget.onDragLeave(draggable);
                }

                target.onDragEnter(draggable);
                this.currentDropTarget = target;
              }

              // Notify the drop target about the current position.
              target.onDropMove(draggable, viewportCoords);
            }
            // If the previous drop target does not accept the draggable anymore, we
            // notify it that the draggable left.
            else if (this.currentDropTarget === target) {
              target.onDragLeave(draggable);
              this.currentDropTarget = null;
            }
          }
        }
      };

      // This method is called when the pointer is released or the touch is canceled.
      const onMouseUp = (e2: MouseEvent | TouchEvent) => {
        draggable.onMouseUp();

        // If we are currently dragging something over a drop target, we notify both the
        // draggable and the drop target about the drop operation.
        if (this.currentlyDragged) {
          if (this.currentDropTarget) {
            draggable.onDrop(this.currentDropTarget, e2.ctrlKey || e2.metaKey);
            this.currentDropTarget.onDrop(draggable, e2.ctrlKey || e2.metaKey);
          } else {
            draggable.onDragCancel();
          }

          document.body.style.cursor = '';
          this.currentlyDragged = null;
          this.currentDropTarget = null;
          this.emit('drag-end', draggable);
        } else {
          draggable.onClick();
        }

        clearListeners();
      };

      // This method is called when a key is pressed. It cancels the drag
      // operation on Escape and changes the cursor to the copy-cursor on Ctrl.
      const onKeyDown = (e2: KeyboardEvent) => {
        if (e2.key === 'Escape') {
          if (this.currentlyDragged) {
            document.body.style.cursor = '';
            draggable.onDragCancel();
            this.emit('drag-end', draggable);

            if (this.currentDropTarget) {
              this.currentDropTarget.onDropCancel(this.currentlyDragged);
            }

            this.currentlyDragged = null;
            this.currentDropTarget = null;
          }

          clearListeners();
          e2.stopPropagation();
        } else if (e2.key === 'Control' || e2.key === 'Meta') {
          document.body.style.cursor = 'copy';
        }
      };

      // This method is called when a key is released. It changes the cursor back to the
      // move cursor.
      const onKeyUp = (e2: KeyboardEvent) => {
        if (e2.key === 'Control' || e2.key === 'Meta') {
          document.body.style.cursor = 'grabbing';
        }
      };

      const clearListeners = () => {
        window.removeEventListener('mousemove', onMotionEvent);
        window.removeEventListener('touchmove', onMotionEvent);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('touchend', onMouseUp);
        window.removeEventListener('touchcancel', onMouseUp);
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('keyup', onKeyUp, true);
      };

      window.addEventListener('mousemove', onMotionEvent);
      window.addEventListener('touchmove', onMotionEvent);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('touchend', onMouseUp);
      window.addEventListener('touchcancel', onMouseUp);
      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('keyup', onKeyUp, true);
    };

    // We need to store the abort controller to be able to remove the event listeners
    // when the draggable is unregistered.
    const abortController = new AbortController();
    const div = draggable.getDiv();
    div.addEventListener('mousedown', onPointerDown, { signal: abortController.signal });
    div.addEventListener('touchstart', onPointerDown, { signal: abortController.signal });

    this.draggables.set(draggable, abortController);
  }

  /**
   * This method is used to unregister a drop target.
   *
   * @param target The drop target to unregister.
   */
  public unregisterDraggable(draggable: IDraggable) {
    // It can be that the draggable is currently being dragged. In this case, we need to
    // cancel the drag operation.
    if (this.currentlyDragged === draggable) {
      this.currentlyDragged = null;
    }

    // Remove the event listener.
    const abortController = this.draggables.get(draggable);
    abortController.abort();

    // Remove the div from the map.
    this.draggables.delete(draggable);
  }

  /**
   * This method is used to get the current coordinates of a mouse or touch event.
   *
   * @param event The event to get the coordinates from.
   * @returns The coordinates of the event.
   */
  private getCoords(event: MouseEvent | TouchEvent) {
    if (event instanceof MouseEvent) {
      return { x: event.clientX, y: event.clientY };
    } else {
      return {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
      };
    }
  }
}
