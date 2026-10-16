package desktop

import (
	"bytes"
	"encoding/binary"
)

// trayIcon wraps a PNG in the .ico container Windows' tray takes. Since
// Windows Vista an icon may hold a PNG as it is.
func trayIcon(png []byte) []byte {
	const size = 64 // the tray PNGs' width and height
	var ico bytes.Buffer
	_ = binary.Write(&ico, binary.LittleEndian, []uint16{0, 1, 1}) // reserved, an icon, one image
	ico.Write([]byte{size, size, 0, 0})                            // width, height, no palette, reserved
	_ = binary.Write(&ico, binary.LittleEndian, []uint16{1, 32})   // colour planes, bits per pixel
	_ = binary.Write(&ico, binary.LittleEndian, []uint32{uint32(len(png)), 22})
	ico.Write(png)
	return ico.Bytes()
}
