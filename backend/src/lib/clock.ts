// Simulyasiya saatı. Bütün analitika bu saatla işləyir ki, demoda 10 dəqiqəlik qaydanı
// sürətləndirilmiş (×10, ×30) göstərmək mümkün olsun. Sürət 1 olanda real vaxtla eynidir.
export class SimClock {
  private baseSim: number;
  private baseReal: number;
  private _speed: number;

  constructor(start: number = Date.now(), speed = 1) {
    this.baseSim = start;
    this.baseReal = Date.now();
    this._speed = speed;
  }

  now(): number {
    return this.baseSim + (Date.now() - this.baseReal) * this._speed;
  }

  get speed(): number {
    return this._speed;
  }

  setSpeed(speed: number): void {
    const n = this.now();
    this.baseSim = n;
    this.baseReal = Date.now();
    this._speed = Math.max(0.1, Math.min(60, speed));
  }
}

/** Testlər üçün əl ilə idarə olunan saat. */
export class ManualClock extends SimClock {
  private t: number;
  constructor(start = 1_780_000_000_000) {
    super(start, 1);
    this.t = start;
  }
  override now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
