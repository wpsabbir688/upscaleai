"""Minimal pure-torch RRDBNet matching the official RealESRGAN_x4plus weights.

Architecture derived from the checkpoint itself (no basicsr/facexlib dependency):
- conv_first: 3 -> 64
- body: 23 x RRDB, each RRDB = 3 x ResidualDenseBlock_5C (nf=64, gc=32)
  with residual scaling 0.2 at both the RDB and RRDB level
- conv_body: 64 -> 64, global residual
- upsample: nearest x2 -> conv_up1 -> nearest x2 -> conv_up2 (scale 4)
- conv_hr: 64 -> 64, conv_last: 64 -> 3

Weight keys verified against RealESRGAN_x4plus.pth (params_ema, 702 tensors):
conv_first, body.{0..22}.rdb{1..3}.conv{1..5}, conv_body, conv_up1,
conv_up2, conv_hr, conv_last. load_state_dict(strict=True) is enforced so a
shape mismatch fails loudly instead of silently producing garbage.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


class ResidualDenseBlock5C(nn.Module):
    def __init__(self, nf=64, gc=32):
        super().__init__()
        self.conv1 = nn.Conv2d(nf, gc, 3, 1, 1, bias=True)
        self.conv2 = nn.Conv2d(nf + gc, gc, 3, 1, 1, bias=True)
        self.conv3 = nn.Conv2d(nf + gc * 2, gc, 3, 1, 1, bias=True)
        self.conv4 = nn.Conv2d(nf + gc * 3, gc, 3, 1, 1, bias=True)
        self.conv5 = nn.Conv2d(nf + gc * 4, nf, 3, 1, 1, bias=True)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x


class RRDB(nn.Module):
    def __init__(self, nf=64, gc=32):
        super().__init__()
        self.rdb1 = ResidualDenseBlock5C(nf, gc)
        self.rdb2 = ResidualDenseBlock5C(nf, gc)
        self.rdb3 = ResidualDenseBlock5C(nf, gc)

    def forward(self, x):
        out = self.rdb1(x)
        out = self.rdb2(out)
        out = self.rdb3(out)
        return out * 0.2 + x


class RRDBNet(nn.Module):
    def __init__(self, num_in_ch=3, num_out_ch=3, num_feat=64,
                 num_block=23, num_grow_ch=32, scale=4):
        super().__init__()
        assert scale == 4, 'This build only supports the x4 weights (scale=4).'
        self.conv_first = nn.Conv2d(num_in_ch, num_feat, 3, 1, 1, bias=True)
        self.body = nn.ModuleList(
            [RRDB(num_feat, num_grow_ch) for _ in range(num_block)])
        self.conv_body = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_up1 = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_up2 = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_hr = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_last = nn.Conv2d(num_feat, num_out_ch, 3, 1, 1, bias=True)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        feat = self.conv_first(x)
        body_feat = feat
        for block in self.body:
            body_feat = block(body_feat)
        body_feat = self.conv_body(body_feat)
        feat = feat + body_feat
        feat = self.lrelu(self.conv_up1(
            F.interpolate(feat, scale_factor=2, mode='nearest')))
        feat = self.lrelu(self.conv_up2(
            F.interpolate(feat, scale_factor=2, mode='nearest')))
        out = self.conv_last(self.lrelu(self.conv_hr(feat)))
        return out


def load_x4plus(weights_path, device='cpu'):
    """Load RealESRGAN_x4plus.pth (params_ema) into RRDBNet, strict."""
    ckpt = torch.load(weights_path, map_location=device, weights_only=True)
    params = ckpt['params_ema'] if 'params_ema' in ckpt else ckpt
    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64,
                    num_block=23, num_grow_ch=32, scale=4)
    model.load_state_dict(params, strict=True)
    model.eval()
    return model
