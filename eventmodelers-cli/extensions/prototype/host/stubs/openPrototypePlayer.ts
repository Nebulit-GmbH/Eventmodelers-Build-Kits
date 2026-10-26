import { modalService } from './modalService'
// "Back to the prototype" from the replay: closes the overlay.
export const openPrototypePlayer = (_props?: unknown): void => modalService.closeModal()
