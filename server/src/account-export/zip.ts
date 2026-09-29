export interface ZipEntry {
  name: string
  body: Buffer
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})

function crc32(body: Buffer): number {
  let crc = 0xffffffff
  for (const byte of body) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function localHeader(name: Buffer, body: Buffer, checksum: number): Buffer {
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0x0800, 6)
  header.writeUInt16LE(0, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(0, 12)
  header.writeUInt32LE(checksum, 14)
  header.writeUInt32LE(body.length, 18)
  header.writeUInt32LE(body.length, 22)
  header.writeUInt16LE(name.length, 26)
  return header
}

function centralHeader(name: Buffer, body: Buffer, checksum: number, offset: number): Buffer {
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(0x0800, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(0, 12)
  header.writeUInt16LE(0, 14)
  header.writeUInt32LE(checksum, 16)
  header.writeUInt32LE(body.length, 20)
  header.writeUInt32LE(body.length, 24)
  header.writeUInt16LE(name.length, 28)
  header.writeUInt32LE(offset, 42)
  return header
}

/** Минимальный ZIP без сжатия: бинарные оригиналы не перекодируются и сохраняются побайтно. */
export function createStoredZip(entries: readonly ZipEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith("/") || entry.name.includes("..")) throw new Error("Unsafe ZIP entry name")
    const name = Buffer.from(entry.name, "utf8")
    const checksum = crc32(entry.body)
    const local = localHeader(name, entry.body, checksum)
    const central = centralHeader(name, entry.body, checksum, offset)
    localParts.push(local, name, entry.body)
    centralParts.push(central, name)
    offset += local.length + name.length + entry.body.length
  }

  const central = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, central, end])
}
