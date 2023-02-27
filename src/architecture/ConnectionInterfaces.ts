interface ConnectionCommon {
  weight: number;
  gater?: number;
  type?: "positive" | "negative" | "condition";
}

export interface ConnectionInternal extends ConnectionCommon {
  from: number;
  to: number;
}

export interface ConnectionExport extends ConnectionCommon {
  fromUUID: string;
  toUUID: string;
}
