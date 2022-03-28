export interface NetworkInterface {
  input: number;
  output: number;
  dropout: number;

  nodes: {
    index: number;
    mask: number;
    bias: number;
    type: string;
    squash: string;
  }[];

  connections: {
    from: number;
    to: number;
    weight: number;
    gater: (null | number);
  }[];

  toJSON: Function;

  //   gates: ({ from: number; to: number }[]|undefined);
  //   selfconns: ({ from: number; to: number }[]|undefined);
}
