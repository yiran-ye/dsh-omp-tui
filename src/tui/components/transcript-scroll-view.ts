import {
  ScrollView,
  type Component,
  type ScrollViewOptions,
  type ScrollViewScrollToOptions,
} from '@earendil-works/pi-tui'

export class TranscriptScrollView extends ScrollView {
  private followingOutput: boolean

  constructor(
    component: Component,
    options: ScrollViewOptions,
    private readonly onFollowingOutputChange: (following: boolean) => void,
  ) {
    super(component, options)
    this.followingOutput = this.isFollowingEnd
  }

  override scrollTo(scrollTop: number, options: ScrollViewScrollToOptions = {}): void {
    super.scrollTo(scrollTop, options)
    this.notifyFollowingOutputChange()
  }

  override scrollBy(lines: number): number {
    const remaining = super.scrollBy(lines)
    this.notifyFollowingOutputChange()
    return remaining
  }

  override scrollToStart(): void {
    super.scrollToStart()
    this.notifyFollowingOutputChange()
  }

  override scrollToEnd(): void {
    super.scrollToEnd()
    this.notifyFollowingOutputChange()
  }

  override updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void {
    super.updateLayout(contentHeight, viewportHeight, requestRender)
    this.notifyFollowingOutputChange()
  }

  private notifyFollowingOutputChange(): void {
    if (this.followingOutput === this.isFollowingEnd) return
    this.followingOutput = this.isFollowingEnd
    this.onFollowingOutputChange(this.followingOutput)
  }
}
