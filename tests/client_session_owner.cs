// Synthetic Windows application owner. Exercises real OS ancestry and child
// recycling without starting, stopping or impersonating an installed AI app.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;
using System.Web.Script.Serialization;
class SessionOwnerFixture {
    static Process child;
    static System.IO.StreamWriter childInput;
    static readonly object gate = new object();
    static void Emit(string value) { lock(gate) { Console.WriteLine(value); Console.Out.Flush(); } }
    static void Stop() {
        if(child == null) return;
        try { if(!child.HasExited) child.Kill(); child.WaitForExit(); } catch { }
        child.Dispose(); child = null; childInput=null;
    }
    static void Start(string[] args) {
        Stop();
        var info = new ProcessStartInfo(args[0], "\"" + args[1] + "\"") {
            UseShellExecute=false, CreateNoWindow=true, RedirectStandardInput=true,
            RedirectStandardOutput=true, RedirectStandardError=true,
            StandardOutputEncoding=Encoding.UTF8, StandardErrorEncoding=Encoding.UTF8
        };
        child = new Process { StartInfo=info };
        child.OutputDataReceived += (s,e) => { if(e.Data!=null) Emit(e.Data); };
        child.ErrorDataReceived += (s,e) => { if(e.Data!=null) Console.Error.WriteLine(e.Data); };
        child.Start(); childInput=new System.IO.StreamWriter(child.StandardInput.BaseStream,new UTF8Encoding(false));child.BeginOutputReadLine(); child.BeginErrorReadLine();
    }
    static void Main(string[] args) {
        Console.InputEncoding=new UTF8Encoding(false); Console.OutputEncoding=new UTF8Encoding(false);
        var json = new JavaScriptSerializer(); Start(args);
        try {
            string line;
            while((line=Console.ReadLine())!=null) {
                var msg=json.Deserialize<Dictionary<string,object>>(line);
                var method=Convert.ToString(msg["method"]);
                if(method.StartsWith("fixture/")) {
                    if(method=="fixture/start") Start(args); else Stop();
                    Emit(json.Serialize(new {jsonrpc="2.0", id=msg["id"], result=new {ok=true}}));
                    if(method=="fixture/close") break;
                } else { childInput.WriteLine(line); childInput.Flush(); }
            }
        } finally { Stop(); }
    }
}
