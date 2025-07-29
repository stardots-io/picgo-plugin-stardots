import type { PicGo } from 'picgo'
import { IPluginConfig } from 'picgo/dist/utils/interfaces'
import { createHash } from 'crypto'
import { ILocalesKey } from './i18n'
import FormData from 'form-data'
import { ZH_CN, EN, ZH_TW } from './i18n'

const starDotsEndpoint = 'https://api.stardots.io'
const starDotsVersion = 'picgo:1.0.1'

/** StarDots configuration */
interface IStarDotsConfig {
    /** Key */
    key: string
    /** Secret */
    secret: string
    /** Space */
    space: string
}

const config = (ctx: PicGo): IPluginConfig[] => {
    let userConfig: IStarDotsConfig = ctx.getConfig('picBed.stardots')
    return [
        {
            name: 'key',
            type: 'password',
            default: userConfig?.key || '',
            message: "Key",
            required: true
        },
        {
            name: 'secret',
            type: 'password',
            default: userConfig?.secret || '',
            message: "Secret",
            required: true
        },
        {
            name: 'space',
            type: 'input',
            default: userConfig?.space || '',
            message: "Space",
            required: true
        }
    ]
}
  

const handleError = (err: any, ctx: PicGo) => {
  ctx.log.error('StarDots uploader error: ' + JSON.stringify(err))
  ctx.emit('notification', {
    title: 'Upload failed!',
    body: JSON.stringify(err)
  })
  throw err
}

/**
 * Generate authentication request header.
 */
const makeHeaders = (clientKey: string, clientSecret: string): Record<string, string> => {
    const ts = Math.floor(Date.now() / 1000).toString()
    const nonce = `${Date.now()}${10000 + Math.floor(Math.random() * 10000)}`
    const needSignStr = `${ts}|${clientSecret}|${nonce}`
    
    const instance = createHash('md5')
    instance.update(needSignStr)
    const sign = instance.digest('hex').toUpperCase()
  
    const extraInfo = JSON.stringify({
      sdk: 'true',
      language: 'typescript',
      version: starDotsVersion,
      os: process.platform,
      arch: process.arch,
    })
  
    return {
      'x-stardots-timestamp': ts,
      'x-stardots-nonce': nonce,
      'x-stardots-key': clientKey,
      'x-stardots-sign': sign,
      'x-stardots-extra': extraInfo,
    }
  }

const handle = async (ctx: PicGo) => {
  const userConfig: IStarDotsConfig = ctx.getConfig('picBed.stardots')
  if (!userConfig) {
    handleError("config not found!", ctx)
    return ctx
  } else if (!userConfig.key || !userConfig.secret || !userConfig.space) {
    handleError("config invalid!", ctx)
    return ctx
  }
  try {
    let imgList = ctx.output
    const key = userConfig.key
    const secret = userConfig.secret
    const space = userConfig.space
    for (let i in imgList) {
      if (!imgList.hasOwnProperty(i)) continue
      let image = imgList[i].buffer
      if (!image && imgList[i].base64Image) {
        image = Buffer.from(imgList[i].base64Image, 'base64')
      }
      let headers = makeHeaders(key, secret)
      headers['content-type'] = 'multipart/form-data'

      let formData = new FormData()
      formData.append('file', image, imgList[i].fileName)
      formData.append('space', space)
      
      const res = await ctx.request({
        url: `${starDotsEndpoint}/openapi/file/upload`,
        method: 'put',
        body: formData,
        resolveWithFullResponse: true,
        headers: headers,
      })
      if (res.statusCode === 200) {
        delete imgList[i].base64Image
        delete imgList[i].buffer
        const body = res.data as any

        if (body?.code !== 200) {
            handleError(ctx.i18n.translate<ILocalesKey>(('PICBED_STARDOTS_API_CODE_' + body.code) as ILocalesKey), ctx)
            return ctx
        }

        const url = body?.data?.url
        imgList[i].fileName = body?.data?.filename
        imgList[i].imgUrl = url
        imgList[i].url=url
      }else{
        handleError(`status code: ${res.statusCode} with message: ${res.body}`, ctx)
        return ctx
      }
    }
  } catch (err) {
    handleError(err, ctx)
    return ctx
  }
}

export = (ctx: PicGo) => {
    const onRemove = async (files: any, guiApi: any) => {
        const userConfig: IStarDotsConfig = ctx.getConfig('picBed.stardots')
        if (!userConfig) {
          handleError("config not found!", ctx)
          return ctx
        } else if (!userConfig.key || !userConfig.secret || !userConfig.space) {
          handleError("config invalid!", ctx)
          return ctx
        }
    
        const key = userConfig.key
        const secret = userConfig.secret
        const space = userConfig.space
    
        for (let i = 0; i < files.length; i++) {
            let headers = makeHeaders(key, secret)
            headers['content-type'] = 'application/json'
            let url = new URL(files[i].imgUrl)
            let pathnames = url.pathname.split('/')
            let currentSpace = pathnames.length === 3 ? pathnames[1] : space
            let currentFileName = pathnames.length === 3 ? pathnames[2] : files[i].fileName
            const res = await ctx.request({
                url: `${starDotsEndpoint}/openapi/file/delete`,
                method: 'delete',
                body: {
                    space: currentSpace,
                    filenameList: [ currentFileName ]
                },
                resolveWithFullResponse: true,
                headers: headers,
            })
    
            if (res.statusCode === 200) {
                ctx.emit('notification', {
                    title: `Tips`,
                    body: `Delete ${currentFileName} successfully`
                })
            } else {
                ctx.emit('notification', {
                    title: `Tips`,
                    body: `Delete ${currentFileName} failed`
                })
                throw new Error(`Delete ${currentFileName} failed`)
            }
        }
    }

    const register = () => {
        ctx.helper.uploader.register('stardots', {
            handle,
            name: 'StarDots',
            config
        })
        ctx.i18n.addLocale('zh-CN', ZH_CN)
        ctx.i18n.addLocale('en', EN)
        ctx.i18n.addLocale('zh-TW', ZH_TW)
        // register remove event
        ctx.on('remove', onRemove)
    }
    return {
        uploader: 'stardots',
        register
    }
}