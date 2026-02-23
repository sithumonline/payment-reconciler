declare module 'msgreader' {
  export default class MsgReader {
    constructor(arrayBuffer: ArrayBuffer);
    getFileData(): any;
    getAttachment(attachment: any): any;
  }
}
