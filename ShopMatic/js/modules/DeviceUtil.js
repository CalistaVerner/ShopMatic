export class DeviceUtil {
  constructor() {
    this.userAgent = navigator.userAgent;
    this.isMobile = this._isMobileDevice();
    this.isTablet = this._isTablet();
    this.isTouchDevice = this._isTouchDevice();
    this.isDesktop = !this.isMobile && !this.isTablet;
    this.os = this._getOS();
  }

  _isMobileDevice() {
    return /Mobi|Android/i.test(this.userAgent) && !/iPad/i.test(this.userAgent);
  }

  _isTablet() {
    return /iPad|Tablet|Playbook|Silk/i.test(this.userAgent) || 
           (this.isTouchDevice && /Windows/i.test(this.userAgent) && /Touch/i.test(this.userAgent));
  }

  _isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  _getOS() {
    if (/Android/i.test(this.userAgent)) return 'Android';
    if (/iPhone|iPad|iPod/i.test(this.userAgent)) return 'iOS';
    if (/Windows NT/i.test(this.userAgent)) return 'Windows';
    if (/Mac OS X/i.test(this.userAgent)) return 'macOS';
    if (/Linux/i.test(this.userAgent)) return 'Linux';
    return 'Unknown';
  }

  isDesktopDevice() {
    return this.isDesktop;
  }

  isMobileDevice() {
    return this.isMobile;
  }

  isTabletDevice() {
    return this.isTablet;
  }

  isTouchDevice() {
    return this.isTouchDevice;
  }

  getOS() {
    return this.os;
  }

  isTouchScreenDevice() {
    return this.isTouchDevice && (this.isMobile || this.isTablet);
  }
}
