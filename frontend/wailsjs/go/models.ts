export namespace main {
	
	export class FileEntry {
	    path: string;
	    name: string;
	    size: number;
	    isDir: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.size = source["size"];
	        this.isDir = source["isDir"];
	    }
	}
	export class Progress {
	    active: boolean;
	    mode: string;
	    phase: string;
	    code: string;
	    percent: number;
	    bytesDone: number;
	    bytesTotal: number;
	    speedBps: number;
	    etaSeconds: number;
	    fileIndex: number;
	    fileCount: number;
	    currentFile: string;
	    message: string;
	    error: string;
	    destFolder: string;
	
	    static createFrom(source: any = {}) {
	        return new Progress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.active = source["active"];
	        this.mode = source["mode"];
	        this.phase = source["phase"];
	        this.code = source["code"];
	        this.percent = source["percent"];
	        this.bytesDone = source["bytesDone"];
	        this.bytesTotal = source["bytesTotal"];
	        this.speedBps = source["speedBps"];
	        this.etaSeconds = source["etaSeconds"];
	        this.fileIndex = source["fileIndex"];
	        this.fileCount = source["fileCount"];
	        this.currentFile = source["currentFile"];
	        this.message = source["message"];
	        this.error = source["error"];
	        this.destFolder = source["destFolder"];
	    }
	}
	export class UpdateInfo {
	    name: string;
	    current: string;
	    latest: string;
	    available: boolean;
	    url: string;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.current = source["current"];
	        this.latest = source["latest"];
	        this.available = source["available"];
	        this.url = source["url"];
	        this.error = source["error"];
	    }
	}
	export class UpdateStatus {
	    crocui: UpdateInfo;
	    croc: UpdateInfo;
	    checkedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.crocui = this.convertValues(source["crocui"], UpdateInfo);
	        this.croc = this.convertValues(source["croc"], UpdateInfo);
	        this.checkedAt = source["checkedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

