import struct,sys,os,json
def rd(fmt,b,o): return struct.unpack_from(fmt,b,o)
class Pkg:
    def __init__(s,path):
        b=s.b=open(path,'rb').read()
        p=b.find(b'/Game/'); sl,=rd('<i',b,p-4); base=p+sl+4
        s.asset=b[p:p+sl-1].decode().split('/')[-1]
        ncount,noff=rd('<ii',b,base); o=noff; s.names=[]
        for _ in range(ncount):
            l,=rd('<i',b,o);o+=4
            if l<0: x=b[o:o-2*l].decode('utf-16le')[:-1];o+=-2*l
            else: x=b[o:o+l].decode('latin1')[:-1];o+=l
            o+=4;s.names.append(x)
        o=base+16; l,=rd('<i',b,o); o+=4+(l if l>=0 else -2*l)+8
        ecount,eoff,icount,ioff=rd('<iiii',b,o)
        s.imports=[]
        for i in range(icount):
            e=ioff+i*40
            s.imports.append((s.names[rd('<i',b,e+8)[0]], s.names[rd('<i',b,e+20)[0]], rd('<i',b,e+16)[0]))
        s.ser=None; s.cls=None
        for stride in range(60,200,4):
            for k in range(ecount):
                e=eoff+k*stride
                if e+44>len(b): break
                ni,=rd('<i',b,e+16)
                if 0<=ni<len(s.names) and s.names[ni]==s.asset and rd('<i',b,e+20)[0]==0:
                    ci,=rd('<i',b,e); s.ser=rd('<q',b,e+36)[0]
                    s.cls= s.imports[-ci-1][1] if ci<0 else 'export'
                    break
            if s.ser: break
        if not s.ser:
            stride=104
            for st in range(60,200,4):
                e=eoff+st
                if ecount==1 or (e+20<len(b) and rd('<i',b,e)[0]<0): stride=st; break
            for k in range(ecount):
                e=eoff+k*stride; ci,=rd('<i',b,e)
                c=s.imports[-ci-1][1] if ci<0 else 'export'
                if rd('<i',b,e+12)[0]==0 and c not in('MetaData','PackageMetaData'):
                    s.ser=rd('<q',b,e+36)[0]; s.cls=c; break
    def fname(s,o):
        i,n=rd('<ii',s.b,o); x=s.names[i]; return (x if n==0 else f'{x}_{n-1}'),o+8
    def obj(s,o):
        # Imports come back as '/Game/Path/Package.Object' so two assets with the same name in different folders stay apart.
        i,=rd('<i',s.b,o)
        if i==0: return None
        if i>0: return f'export{i}'
        cls,name,outer=s.imports[-i-1]
        if outer<0 and s.imports[-outer-1][0]=='Package': return s.imports[-outer-1][1]+'.'+name
        return name
    def tn(s,o):
        n,o=s.fname(o); c,=rd('<i',s.b,o);o+=4; ch=[]
        for _ in range(c): t,o=s.tn(o); ch.append(t)
        return (n,ch),o
    def fstr(s,o):
        l,=rd('<i',s.b,o);o+=4
        if l==0: return '',o
        if l<0: return s.b[o:o-2*l].decode('utf-16le')[:-1],o-2*l
        return s.b[o:o+l].decode('utf-8','replace')[:-1],o+l
    def text(s,o): return s.text2(o)[0]
    def text2(s,o):
        fl,=rd('<i',s.b,o);o+=4; h=rd('<b',s.b,o)[0];o+=1
        if h==-1:
            has=rd('<i',s.b,o)[0];o+=4
            if has: return s.fstr(o)
            return '',o
        if h==0:
            _,o=s.fstr(o);_,o=s.fstr(o); return s.fstr(o)
        if h in(1,2,3):
            pat,o=s.text2(o); c,=rd('<i',s.b,o);o+=4
            for i in range(c):
                key=str(i)
                if h==1: key,o=s.fstr(o)
                elif h==3: key,o=s.fstr(o)
                t=rd('<b',s.b,o)[0];o+=1
                if t in(0,1): v=str(rd('<q',s.b,o)[0]);o+=8
                elif t==2: v=f"{rd('<f',s.b,o)[0]:g}";o+=4
                elif t==3: v=f"{rd('<d',s.b,o)[0]:g}";o+=8
                elif t==4: v,o=s.text2(o)
                else: o+=1; v='?'
                pat=pat.replace('{'+key+'}',v)
            return pat,o
        if h==11:
            t,o=s.fname(o); k,o=s.fstr(o); return f'[{t}:{k}]',o
        return '<text>',o
    def props(s,o):
        out={}
        while True:
            n,o=s.fname(o)
            if n=='None': return out,o
            t,o=s.tn(o); size,=rd('<i',s.b,o);o+=4; fl=s.b[o];o+=1
            if fl&1:o+=4
            if fl&2:o+=16
            if fl&4: o+=1  # property extensions (approx)
            try: out[n]=s.val(t,o,fl,size)[0]
            except Exception as e: out[n]=f'<err {t[0]}>'
            o+=size
    def val(s,t,o,fl,size=None):
        n=t[0]; b=s.b
        if n=='FloatProperty': return round(rd('<f',b,o)[0],4),o+4
        if n=='DoubleProperty': return round(rd('<d',b,o)[0],4),o+8
        if n in('IntProperty',): return rd('<i',b,o)[0],o+4
        if n=='UInt32Property': return rd('<I',b,o)[0],o+4
        if n=='Int64Property': return rd('<q',b,o)[0],o+8
        if n=='BoolProperty': return bool(fl&0x10),o
        if n in('ObjectProperty','ClassProperty','InterfaceProperty'): return s.obj(o),o+4
        if n in('SoftObjectProperty','SoftClassProperty'):
            p,o2=s.fname(o); a,o2=s.fname(o2); sub,o2=s.fstr(o2); return (a.split('.')[-1] if a!='None' else None),o2
        if n=='NameProperty': return s.fname(o)
        if n=='StrProperty': return s.fstr(o)
        if n=='TextProperty': return s.text(o),o+(size or 0)
        if n in('EnumProperty',):
            v,o2=s.fname(o); return v.split('::')[-1],o2
        if n=='ByteProperty':
            if t[1]:
                v,o2=s.fname(o); return v.split('::')[-1],o2
            return b[o],o+1
        if n=='StructProperty':
            sn=t[1][0][0] if t[1] else ''
            if sn in('Guid',): return None,o+16
            if sn=='GameplayTag': return s.fname(o)
            if sn in('Vector','Rotator'): return list(rd('<3d',b,o)),o+24
            if sn=='LinearColor': return list(rd('<4f',b,o)),o+16
            return s.props(o)
        if n in('ArrayProperty','SetProperty'):
            if n=='SetProperty': o+=4
            c,=rd('<i',b,o);o+=4;a=[]
            for _ in range(c): v,o=s.val(t[1][0],o,0); a.append(v)
            return a,o
        if n=='MapProperty':
            o+=4; c,=rd('<i',b,o);o+=4; m={}
            for _ in range(c):
                k,o=s.val(t[1][0],o,0); v,o=s.val(t[1][1],o,0); m[str(k)]=v
            return m,o
        raise Exception(n)
    def read(s):
        p,o=s.props(s.ser+1)
        if s.cls=='DataTable':
            o+=4
            rows={}
            try:
                c,=rd('<i',s.b,o); o+=4
                for _ in range(c):
                    rn,o=s.fname(o); v,o=s.props(o); rows[rn]=v
            except Exception as e: rows['_error']=repr(e)
            p['_rows']=rows
        return p
if __name__=='__main__':
    out={}
    for f in sys.argv[1:]:
        try:
            k=Pkg(f); rel=f.replace(os.sep,'/').split('/Content/')[-1]
            out[rel]={'_class':k.cls,'_object':k.asset,'_path':rel,**k.read()}
        except Exception as e: out[os.path.basename(f)]={'_error':repr(e)}
    print(json.dumps(out,indent=1,ensure_ascii=False))
