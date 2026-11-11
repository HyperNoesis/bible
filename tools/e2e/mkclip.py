# Deterministic test clip: a webcam-like talking-head (static camera, sensor noise, 1-2 px sway, blink) -> fixtures/webcam_clip.mjpeg (<3 MB).
# Needs numpy, opencv, ffmpeg and /tmp/srv/fx from mkfx.py. SYNTHETIC person: swap in a real consented clip with the same name when you have one.
import numpy as np, cv2, subprocess, os
FX=os.environ.get('GENESIS_FX','/tmp/srv/fx'); out=os.path.join(os.path.dirname(__file__),'fixtures'); os.makedirs(out,exist_ok=True)
bg=cv2.imread(FX+'/bg.png').astype(np.float32); per=cv2.imread(FX+'/gt_person.png').astype(np.float32); al=cv2.imread(FX+'/gt_alpha.png',0).astype(np.float32)/255
W,H=640,480; N=60; rng=np.random.default_rng(11)
p=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pix_fmt','bgr24','-s',f'{W}x{H}','-r','15','-i','-','-c:v','mjpeg','-q:v','4','-pix_fmt','yuvj420p',out+'/webcam_clip.mjpeg'],stdin=subprocess.PIPE)
h,w=al.shape
for i in range(N):
    dx=1.5*np.sin(i/9.0); dy=1.0*np.sin(i/13.0)
    M=np.float32([[1,0,dx],[0,1,dy]])
    a=cv2.warpAffine(al,M,(w,h),flags=cv2.INTER_LINEAR); c=cv2.warpAffine(per,M,(w,h),flags=cv2.INTER_LINEAR)
    f=bg*(1-a[...,None])+c*a[...,None]
    f=f+rng.normal(0,2.0,f.shape)  # sensor noise
    f=cv2.resize(np.clip(f,0,255).astype(np.uint8),(W,H),interpolation=cv2.INTER_AREA)
    p.stdin.write(f.tobytes())
p.stdin.close(); p.wait()
print(os.path.getsize(out+'/webcam_clip.mjpeg'),'bytes')
