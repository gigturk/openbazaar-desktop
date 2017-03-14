import $ from 'jquery';
import '../../../utils/velocity';
import '../../../lib/select2';
import Sortable from 'sortablejs';
import _ from 'underscore';
import path from 'path';
import '../../../utils/velocityUiPack.js';
import Backbone from 'backbone';
import { isScrolledIntoView } from '../../../utils/dom';
import { installRichEditor } from '../../../utils/trumbowyg';
import { getCurrenciesSortedByCode } from '../../../data/currencies';
import { formatPrice } from '../../../utils/currency';
import SimpleMessage from '../SimpleMessage';
import loadTemplate from '../../../utils/loadTemplate';
import ShippingOptionMd from '../../../models/listing/ShippingOption';
import Service from '../../../models/listing/Service';
import Image from '../../../models/listing/Image';
import Coupon from '../../../models/listing/Coupon';
import VariantOption from '../../../models/listing/VariantOption';
import app from '../../../app';
import BaseModal from '../BaseModal';
import ShippingOption from './ShippingOption';
import Coupons from './Coupons';
import Variants from './Variants';
import VariantInventory from './VariantInventory';

export default class extends BaseModal {
  constructor(options = {}) {
    if (!options.model) {
      throw new Error('Please provide a model.');
    }

    const opts = {
      removeOnClose: true,
      ...options,
    };

    super(opts);
    this.options = opts;

    // So the passed in modal does not get any un-saved data,
    // we'll clone and update it on sync
    this._origModel = this.model;
    this.model = this._origModel.clone();
    this.listenTo(this.model, 'sync', () => {
      setTimeout(() => {
        if (this.createMode && !this.model.isNew()) {
          this.createMode = false;
          this.$('.js-listingHeading').text(app.polyglot.t('editListing.editListingLabel'));
        }

        this._origModel.set(this.model.toJSON());
      });

      // A change event won't fire on a parent model if only nested attributes change.
      // The nested models would need to have change events manually bound to them
      // which is cumbersome with a model like this with so many levels of nesting.
      // If you are interested in any change on the model (as opposed to a sepcific
      // attribute), the simplest thing to do is use the 'saved' event from the
      // event emitter in models/listing/index.js.
    });

    this.selectedNavTabIndex = 0;
    this.createMode = !(this.model.lastSyncedAttrs &&
      this.model.lastSyncedAttrs.slug);
    this.photoUploads = [];
    this.images = this.model.get('item').get('images');
    this.shippingOptions = this.model.get('shippingOptions');
    this.shippingOptionViews = [];

    loadTemplate('modals/editListing/uploadPhoto.html',
      uploadT => (this.uploadPhotoT = uploadT));

    this.listenTo(this.images, 'add', this.onAddImage);
    this.listenTo(this.images, 'remove', this.onRemoveImage);

    this.listenTo(this.shippingOptions, 'add', (shipOptMd) => {
      const shipOptVw = this.createShippingOptionView({
        listPosition: this.shippingOptions.length,
        model: shipOptMd,
      });

      this.shippingOptionViews.push(shipOptVw);
      this.$shippingOptionsWrap.append(shipOptVw.render().el);
    });

    this.listenTo(this.shippingOptions, 'remove', (shipOptMd, shipOptCl, removeOpts) => {
      const [splicedVw] = this.shippingOptionViews.splice(removeOpts.index, 1);
      splicedVw.remove();
      this.shippingOptionViews.slice(removeOpts.index)
        .forEach(shipOptVw => (shipOptVw.listPosition = shipOptVw.listPosition - 1));
    });

    this.listenTo(this.shippingOptions, 'update', (cl, updateOpts) => {
      if (!(updateOpts.changes.added.length || updateOpts.changes.removed.length)) {
        return;
      }

      this.$addShipOptSectionHeading
        .text(app.polyglot.t('editListing.shippingOptions.optionHeading',
          { listPosition: this.shippingOptions.length + 1 }));
    });

    this.coupons = this.model.get('coupons');
    this.listenTo(this.coupons, 'update', () => {
      if (this.coupons.length) {
        this.$couponsSection.addClass('expandedCouponView');
      } else {
        this.$couponsSection.removeClass('expandedCouponView');
      }
    });

    this.variantOptionsCl = this.model.get('item')
      .get('options');

    this.listenTo(this.variantOptionsCl, 'update', this.onUpdateVariantOptions);
    this.listenTo(this.variantOptionsCl, 'change:variants', () => {
      this.$variantInventorySection.toggleClass('hide',
        !this.shouldShowVariantInventorySection);
    });

    this.$el.on('scroll', () => {
      if (this.el.scrollTop > 57 && !this.$el.hasClass('fixedNav')) {
        this.$el.addClass('fixedNav');
      } else if (this.el.scrollTop <= 57 && this.$el.hasClass('fixedNav')) {
        this.$el.removeClass('fixedNav');
      }
    });
  }

  className() {
    return `${super.className()} editListing tabbedModal modalScrollPage`;
  }

  events() {
    return {
      'click .js-scrollLink': 'onScrollLinkClick',
      'click .js-return': 'onClickReturn',
      'click .js-save': 'onSaveClick',
      'change #editContractType': 'onChangeContractType',
      'change .js-price': 'onChangePrice',
      'change #inputPhotoUpload': 'onChangePhotoUploadInput',
      'click .js-addPhoto': 'onClickAddPhoto',
      'click .js-removeImage': 'onClickRemoveImage',
      'click .js-cancelPhotoUploads': 'onClickCancelPhotoUploads',
      'click .js-addReturnPolicy': 'onClickAddReturnPolicy',
      'click .js-addTermsAndConditions': 'onClickAddTermsAndConditions',
      'click .js-addShippingOption': 'onClickAddShippingOption',
      'click .js-btnAddCoupon': 'onClickAddCoupon',
      'click .js-addFirstVariant': 'onClickAddFirstVariant',
      'keyup .js-variantNameInput': 'onKeyUpVariantName',
      ...super.events(),
    };
  }

  get MAX_PHOTOS() {
    return this.model.get('item').max.images;
  }

  onClickReturn() {
    this.trigger('click-return', { view: this });
  }

  onAddImage(image) {
    const imageHtml = this.uploadPhotoT({
      closeIconClass: 'js-removeImage',
      ...image.toJSON(),
    });

    this.$photoUploadItems.append(imageHtml);
  }

  onRemoveImage(image, images, options) {
    // 1 is added to the index to account for the .addElement
    this.$photoUploadItems.find('li')
      .eq(options.index + 1)
      .remove();
  }

  onClickRemoveImage(e) {
    // since the first li is the .addElement, we need to subtract 1 from the index
    const removeIndex = $(e.target).parents('li').index() - 1;

    this.images.remove(this.images.at(removeIndex));
  }

  onClickCancelPhotoUploads() {
    this.inProgressPhotoUploads.forEach(photoUpload => photoUpload.abort());
  }

  onChangePrice(e) {
    const trimmedVal = $(e.target).val().trim();
    const numericVal = Number(trimmedVal);

    if (!isNaN(numericVal) && trimmedVal) {
      $(e.target).val(
        formatPrice(numericVal, this.$currencySelect.val() === 'BTC')
      );
    } else {
      $(e.target).val(trimmedVal);
    }

    // const price = this.getFormData($(e.target)).item.price;
    // this.model.get('item')
    //   .set('price', price);
    this.variantInventory.render();
  }

  onChangeContractType(e) {
    if (e.target.value !== 'PHYSICAL_GOOD') {
      this.$conditionWrap
        .add(this.$sectionShipping)
        .addClass('disabled');
    } else {
      this.$conditionWrap
        .add(this.$sectionShipping)
        .removeClass('disabled');
    }
  }

  getOrientation(file, callback) {
    const reader = new FileReader();

    reader.onload = (e) => {
      const dataView = new DataView(e.target.result);  // eslint-disable-line no-undef
      let offset = 2;

      if (dataView.getUint16(0, false) !== 0xFFD8) return callback(-2);

      while (offset < dataView.byteLength) {
        const marker = dataView.getUint16(offset, false);
        offset += 2;
        if (marker === 0xFFE1) {
          offset += 2;
          if (dataView.getUint32(offset, false) !== 0x45786966) {
            return callback(-1);
          }
          const little = dataView.getUint16(offset += 6, false) === 0x4949;
          offset += dataView.getUint32(offset + 4, little);
          const tags = dataView.getUint16(offset, little);
          offset += 2;
          for (let i = 0; i < tags; i++) {
            if (dataView.getUint16(offset + (i * 12), little) === 0x0112) {
              return callback(dataView.getUint16(offset + (i * 12) + 8, little));
            }
          }
        } else if ((marker & 0xFF00) !== 0xFF00) {
          break;
        } else {
          offset += dataView.getUint16(offset, false);
        }
      }

      return callback(-1);
    };

    reader.readAsArrayBuffer(file.slice(0, 64 * 1024));
  }

  // todo: write a unit test for this
  truncateImageFilename(filename) {
    if (!filename || typeof filename !== 'string') {
      throw new Error('Please provide a filename as a string.');
    }

    const truncated = filename;

    if (filename.length > Image.maxFilenameLength) {
      const parsed = path.parse(filename);
      const nameParseLen = Image.maxFilenameLength - parsed.ext.length;

      // acounting for rare edge case of the extension in and of itself
      // exceeding the max length
      return parsed.name.slice(0, nameParseLen < 0 ? 0 : nameParseLen) +
        parsed.ext.slice(0, Image.maxFilenameLength);
    }

    return truncated;
  }

  onChangePhotoUploadInput() {
    let photoFiles = Array.prototype.slice.call(this.$inputPhotoUpload[0].files, 0);

    // prune out any non-image files
    photoFiles = photoFiles.filter(file => file.type.startsWith('image'));

    this.$inputPhotoUpload.val('');

    const currPhotoLength = this.model.get('item')
      .get('images')
      .length;

    if (currPhotoLength + photoFiles.length > this.MAX_PHOTOS) {
      photoFiles = photoFiles.slice(0, this.MAX_PHOTOS - currPhotoLength);

      new SimpleMessage({
        title: app.polyglot.t('editListing.errors.tooManyPhotosTitle'),
        message: app.polyglot.t('editListing.errors.tooManyPhotosBody'),
      })
      .render()
      .open();
    }

    if (!photoFiles.length) return;

    this.$photoUploadingLabel.removeClass('hide');

    const toUpload = [];
    let loaded = 0;
    let errored = 0;

    photoFiles.forEach(photoFile => {
      const newImage = document.createElement('img');

      newImage.src = photoFile.path;

      newImage.onload = () => {
        const imgW = newImage.width;
        const imgH = newImage.height;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = imgW;
        canvas.height = imgH;

        this.getOrientation(photoFile, (orientation) => {
          switch (orientation) {
            case 2:
              ctx.translate(imgW, 0);
              ctx.scale(-1, 1); break;
            case 3:
              ctx.translate(imgW, imgH);
              ctx.rotate(Math.PI); break;
            case 4:
              ctx.translate(0, imgH);
              ctx.scale(1, -1); break;
            case 5:
              ctx.rotate(0.5 * Math.PI);
              ctx.scale(1, -1); break;
            case 6:
              ctx.rotate(0.5 * Math.PI);
              ctx.translate(0, -imgH); break;
            case 7:
              ctx.rotate(0.5 * Math.PI);
              ctx.translate(imgW, -imgH);
              ctx.scale(-1, 1); break;
            case 8:
              ctx.rotate(-0.5 * Math.PI);
              ctx.translate(-imgW, 0); break;
            default: // do nothing
          }

          ctx.drawImage(newImage, 0, 0, imgW, imgH);
          toUpload.push({
            filename: this.truncateImageFilename(photoFile.name),
            image: canvas.toDataURL('image/jpeg', 0.9)
              .replace(/^data:image\/(png|jpeg|webp);base64,/, ''),
          });

          loaded += 1;

          if (loaded + errored === photoFiles.length) {
            this.uploadImages(toUpload);
          }
        });
      };

      newImage.onerror = () => {
        errored += 1;

        if (errored === photoFiles.length) {
          this.$photoUploadingLabel.addClass('hide');

          new SimpleMessage({
            title: app.polyglot.t('editListing.errors.unableToLoadImages',
              { smart_count: errored }),
          })
          .render()
          .open();
        } else if (loaded + errored === photoFiles.length) {
          this.uploadImages(toUpload);
        }
      };
    });
  }

  onClickAddReturnPolicy(e) {
    $(e.target).addClass('hide');
    this.$editListingReturnPolicy.removeClass('hide')
      .focus();
    this.expandedReturnPolicy = true;
  }

  onClickAddTermsAndConditions(e) {
    $(e.target).addClass('hide');
    this.$editListingTermsAndConditions.removeClass('hide')
      .focus();
    this.expandedTermsAndConditions = true;
  }

  onClickAddShippingOption() {
    this.shippingOptions
      .push(new ShippingOptionMd({
        services: [
          new Service(),
        ],
      }));
  }

  onClickAddCoupon() {
    this.coupons.add(new Coupon());

    if (this.coupons.length === 1) {
      this.$couponsSection.find('.coupon input[name=title]')
        .focus();
    }
  }

  onClickAddFirstVariant() {
    this.variantOptionsCl.add(new VariantOption());

    if (this.variantOptionsCl.length === 1) {
      this.$variantsSection.find('.variant input[name=name]')
        .focus();
    }
  }

  onKeyUpVariantName(e) {
    // TODO TODO TODO: throttle this guy
    const index = $(e.target).closest('.variant')
      .index();

    this.variantsView.setModelData(index);
  }

  onVariantChoiceChange(e) {
    const index = this.variantsView.views
      .indexOf(e.view);

    this.variantsView.setModelData(index);
  }

  onUpdateVariantOptions() {
    if (this.variantOptionsCl.length) {
      this.$variantsSection.addClass('expandedVariantsView');
    } else {
      this.$variantsSection.removeClass('expandedVariantsView');
    }

    this.$variantInventorySection.toggleClass('hide',
      !this.shouldShowVariantInventorySection);
  }

  get shouldShowVariantInventorySection() {
    // Need at least 2 variantOptions with each having at least 1 choice
    if (this.variantOptionsCl.length > 1) {
      const haveChoices = this.variantOptionsCl.filter(variantOption => {
        const choices = variantOption.get('variants');
        return choices && choices.length;
      });

      if (haveChoices.length > 1) {
        return true;
      }
    }

    return false;
  }

  uploadImages(images) {
    let imagesToUpload = images;

    if (!images) {
      throw new Error('Please provide a list of images to upload.');
    }

    if (typeof images === 'string') {
      imagesToUpload = [images];
    }

    const upload = $.ajax({
      url: app.getServerUrl('ob/images'),
      type: 'POST',
      data: JSON.stringify(imagesToUpload),
      dataType: 'json',
      contentType: 'application/json',
    }).always(() => {
      if (this.isRemoved()) return;
      if (!this.inProgressPhotoUploads.length) this.$photoUploadingLabel.addClass('hide');
    }).done(uploadedImages => {
      if (this.isRemoved()) return;

      this.images.add(uploadedImages.map(image => ({
        filename: image.filename,
        original: image.hashes.original,
        large: image.hashes.large,
        medium: image.hashes.medium,
        small: image.hashes.small,
        tiny: image.hashes.tiny,
      })));
    });

    this.photoUploads.push(upload);
  }

  get inProgressPhotoUploads() {
    return this.photoUploads
      .filter(upload => upload.state() === 'pending');
  }

  onClickAddPhoto() {
    this.$inputPhotoUpload.trigger('click');
  }

  onScrollLinkClick(e) {
    const index = $(e.target).index();
    this.selectedNavTabIndex = index;
    this.$scrollLinks.removeClass('active');
    $(e.target).addClass('active');
    this.$el.off('scroll', this.throttledOnScroll);

    // Had this initially in Velocity, but after markup re-factor, it
    // doesn't work consistently, so we'll go old-school for now.
    this.$el
      .animate({
        scrollTop: this.$scrollToSections.eq(index)
          .position()
          .top,
      }, {
        complete: () => {
          setTimeout(
            () => this.$el.on('scroll', this.throttledOnScroll),
            100);
        },
      }, 400);
  }

  onScroll() {
    let index = 0;
    let keepLooping = true;

    while (keepLooping) {
      if (isScrolledIntoView(this.$scrollToSections[index])) {
        this.$scrollLinks.removeClass('active');
        this.$scrollLinks.eq(index).addClass('active');
        this.selectedNavTabIndex = index;
        keepLooping = false;
      } else {
        if (index === this.$scrollToSections.length - 1) {
          keepLooping = false;
        } else {
          index += 1;
        }
      }
    }
  }

  onSaveClick() {
    const formData = this.getFormData(this.$formFields);

    this.$saveButton.addClass('disabled');

    // set model / collection data for variaous child views
    this.shippingOptionViews.forEach((shipOptVw) => shipOptVw.setModelData());
    this.variantsView.setCollectionData();
    this.variantInventory.setCollectionData();
    this.couponsView.setCollectionData();

    // If the variantInventory section is hidden, we'll clear out
    // any of its data.
    if (!this.shouldShowVariantInventorySection) {
      formData.skus = [];
    }

    // TEMP TEMP TEMP until full variant work is done
    if (formData && formData.item) {
      delete formData.item.productId;
    }

    this.model.set(formData);

    // If the type is not 'PHYSICAL_GOOD', we'll clear out any shipping options.
    if (this.model.get('metadata').get('contractType') !== 'PHYSICAL_GOOD') {
      this.model.get('shippingOptions').reset();
    } else {
      // If any shipping options have a type of 'LOCAL_PICKUP', we'll
      // clear out any services that may be there.
      this.model.get('shippingOptions').forEach(shipOpt => {
        if (shipOpt.get('type') === 'LOCAL_PICKUP') {
          shipOpt.set('services', []);
        }
      });
    }

    const serverData = this.model.toJSON();
    serverData.item.skus = serverData.item.skus.map(sku => _.omit(sku, 'mappingId', 'choices'));

    // The variant inventory view adds some stuff to the skus collection that
    // shouldn't go to the server. We'll ensure the extraneous stuff isn't sent
    // with the save while still allowing it to stay in the collection.
    const save = this.model.save({}, {
      attrs: serverData,
    });

    if (save) {
      const savingStatusMsg = app.statusBar.pushMessage({
        msg: 'Saving listing...',
        type: 'message',
        duration: 99999999999999,
      }).on('clickViewListing', () => {
        const url = `#${app.profile.id}/store/${this.model.get('slug')}`;

        // This couldn't have been a simple href because that URL may already be the
        // page we're on, with the Listing Detail likely obscured by this modal. Since
        // the url wouldn't be changing, clicking that anchor would do nothing, hence
        // the use of loadUrl.
        Backbone.history.loadUrl(url);
      });

      save.always(() => this.$saveButton.removeClass('disabled'))
        .fail((...args) => {
          savingStatusMsg.update({
            msg: `Listing <em>${this.model.toJSON().item.title}</em> failed to save.`,
            type: 'warning',
          });

          setTimeout(() => savingStatusMsg.remove(), 3000);

          new SimpleMessage({
            title: app.polyglot.t('editListing.errors.saveErrorTitle'),
            message: args[0] && args[0].responseJSON && args[0].responseJSON.reason || '',
          })
          .render()
          .open();
        }).done(() => {
          savingStatusMsg.update(`Listing ${this.model.toJSON().item.title}` +
            ' saved. <a class="js-viewListing">view</a>');

          setTimeout(() => savingStatusMsg.remove(), 6000);
        });
    } else {
      // client side validation failed
      this.$saveButton.removeClass('disabled');
      console.log('no soup for you');
      window.soup = this.model;
    }

    // render so errrors are shown / cleared
    this.render(!!save);
    const $firstErr = this.$('.errorList:first');
    if ($firstErr.length) $firstErr[0].scrollIntoViewIfNeeded();
  }

  get $scrollToSections() {
    return this._$scrollToSections ||
      (this._$scrollToSections = this.$('.js-scrollToSection'));
  }

  get $scrollLinks() {
    return this._$scrollLinks ||
      (this._$scrollLinks = this.$('.js-scrollLink'));
  }

  get $formFields() {
    const excludes = '.js-sectionShipping, .js-couponsSection, .js-variantsSection, ' +
      '.js-variantInventorySection';

    return this._$formFields ||
      (this._$formFields = this.$(
        `.js-scrollToSection:not(${excludes}) select[name],` +
        `.js-scrollToSection:not(${excludes}) input[name],` +
        `.js-scrollToSection:not(${excludes}) div[contenteditable][name],` +
        `.js-scrollToSection:not(${excludes}) textarea[name]:not([class*="trumbowyg"])`
      ));
  }

  get $currencySelect() {
    return this._$currencySelect ||
      (this._$currencySelect = this.$('#editListingCurrency'));
  }

  get $priceInput() {
    return this._$priceInput ||
      (this._$priceInput = this.$('#editListingPrice'));
  }

  get $conditionWrap() {
    return this._$conditionWrap ||
      (this._$conditionWrap = this.$('.js-conditionWrap'));
  }

  get $saveButton() {
    return this._$buttonSave ||
      (this._$buttonSave = this.$('.js-save'));
  }

  get $inputPhotoUpload() {
    return this._$inputPhotoUpload ||
      (this._$inputPhotoUpload = this.$('#inputPhotoUpload'));
  }

  get $photoUploadingLabel() {
    return this._$photoUploadingLabel ||
      (this._$photoUploadingLabel = this.$('.js-photoUploadingLabel'));
  }

  get $editListingReturnPolicy() {
    return this._$editListingReturnPolicy ||
      (this._$editListingReturnPolicy = this.$('#editListingReturnPolicy'));
  }

  get $editListingTermsAndConditions() {
    return this._$editListingTermsAndConditions ||
      (this._$editListingTermsAndConditions = this.$('#editListingTermsAndConditions'));
  }

  get $sectionShipping() {
    return this._$sectionShipping ||
      (this._$sectionShipping = this.$('.js-sectionShipping'));
  }

  get $maxCatsWarning() {
    return this._$maxCatsWarning ||
      (this._$maxCatsWarning = this.$('.js-maxCatsWarning'));
  }

  get $maxTagsWarning() {
    return this._$maxTagsWarning ||
      (this._$maxTagsWarning = this.$('.js-maxTagsWarning'));
  }

  get maxTagsWarning() {
    return `<div class="clrT2 tx5 row">${app.polyglot.t('editListing.maxTagsWarning')}</div>`;
  }

  get $addShipOptSectionHeading() {
    return this._$addShipOptSectionHeading ||
      (this._$addShipOptSectionHeading = this.$('.js-addShipOptSectionHeading'));
  }

  get $variantInventorySection() {
    return this._$variantInventorySection ||
      (this._$variantInventorySection = this.$('.js-variantInventorySection'));
  }

  get $itemPrice() {
    return this._$itemPrice ||
      (this._$itemPrice = this.$('[name="item.price"]'));
  }

  showMaxTagsWarning() {
    this.$maxTagsWarning.empty()
      .append(this.maxTagsWarning);
  }

  hideMaxTagsWarning() {
    this.$maxTagsWarning.empty();
  }

  get maxCatsWarning() {
    return `<div class="clrT2 tx5 row">${app.polyglot.t('editListing.maxCatsWarning')}</div>`;
  }

  showMaxCatsWarning() {
    this.$maxCatsWarning.empty()
      .append(this.maxCatsWarning);
  }

  hideMaxCatsWarning() {
    this.$maxCatsWarning.empty();
  }

  // return the currency associated with this listing
  get currency() {
    return (this.$currencySelect.length ?
        this.$currencySelect.val() : this.model.get('metadata').get('pricingCurrency') ||
          app.settings.get('localCurrency'));
  }

  createShippingOptionView(opts) {
    const options = {
      getCurrency: () => (this.$currencySelect.length ?
        this.$currencySelect.val() : this.model.get('metadata').pricingCurrency),
      ...opts || {},
    };
    const view = this.createChild(ShippingOption, options);

    this.listenTo(view, 'click-remove', e => {
      this.shippingOptions.remove(
        this.shippingOptions.at(this.shippingOptionViews.indexOf(e.view)));
    });

    return view;
  }

  remove() {
    this.inProgressPhotoUploads.forEach(upload => upload.abort());
    $(window).off('resize', this.throttledResizeWin);

    super.remove();
  }

  render(restoreScrollPos = true) {
    let prevScrollPos = 0;
    const item = this.model.get('item');

    if (restoreScrollPos) {
      prevScrollPos = this.el.scrollTop;
    }

    if (this.throttledOnScroll) this.$el.off('scroll', this.throttledOnScroll);
    this.currencies = this.currencies || getCurrenciesSortedByCode();

    loadTemplate('modals/editListing/editListing.html', t => {
      this.$el.html(t({
        createMode: this.createMode,
        selectedNavTabIndex: this.selectedNavTabIndex,
        returnText: this.options.returnText,
        currency: this.currency,
        currencies: this.currencies,
        contractTypes: this.model.get('metadata')
          .contractTypes
          .map((contractType) => ({ code: contractType,
            name: app.polyglot.t(`formats.${contractType}`) })),
        conditionTypes: this.model.get('item')
          .conditionTypes
          .map((conditionType) => ({ code: conditionType,
            name: app.polyglot.t(`conditionTypes.${conditionType}`) })),
        errors: this.model.validationError || {},
        photoUploadInprogress: !!this.inProgressPhotoUploads.length,
        uploadPhotoT: this.uploadPhotoT,
        expandedReturnPolicy: this.expandedReturnPolicy || !!this.model.get('refundPolicy'),
        expandedTermsAndConditions: this.expandedTermsAndConditions ||
          !!this.model.get('termsAndConditions'),
        formatPrice,
        maxCatsWarning: this.maxCatsWarning,
        maxTagsWarning: this.maxTagsWarning,
        max: {
          title: item.max.titleLength,
          cats: item.max.cats,
          tags: item.max.tags,
          photos: this.MAX_PHOTOS,
        },
        shouldShowVariantInventorySection: this.shouldShowVariantInventorySection,
        ...this.model.toJSON(),
      }));

      super.render();

      this.$editListingTags = this.$('#editListingTags');
      this.$editListingTagsPlaceholder = this.$('#editListingTagsPlaceholder');
      this.$editListingCategories = this.$('#editListingCategories');
      this.$editListingCategoriesPlaceholder = this.$('#editListingCategoriesPlaceholder');
      this.$editListingVariantsChoices = this.$('#editListingVariantsChoices');
      this.$editListingVariantsChoicesPlaceholder =
        this.$('#editListingVariantsChoicesPlaceholder');
      this.$shippingOptionsWrap = this.$('.js-shippingOptionsWrap');
      this.$couponsSection = this.$('.js-couponsSection');
      this.$variantsSection = this.$('.js-variantsSection');

      this.$('#editContractType, #editListingVisibility, #editListingCondition, ' +
        '#editInventoryManagementType').select2({
          // disables the search box
          minimumResultsForSearch: Infinity,
        });

      this.$('#editListingCurrency').select2()
        .on('change', () => this.variantInventory.render());

      this.$editListingTags.select2({
        multiple: true,
        tags: true,
        // ***
        // placeholder has issue where it won't show initially, will use
        // own element for this instead
        // placeholder: 'Enter tags... (and translate me)',
        // ***
        // dropdownParent needed to fully hide dropdown
        dropdownParent: this.$('#editListingTagsDropdown'),
        createTag: (params) => {
          let term = params.term;

          // we'll make the tag all lowercase and
          // replace spaces with dashes.
          term = term.toLowerCase()
              .replace(/\s/g, '-')
              .replace('#', '')
              // replace consecutive dashes with one
              .replace(/-{2,}/g, '-');

          return {
            id: term,
            text: term,
          };
        },
        // This is necessary, otherwise partial matches of existing tags are
        // prevented. E,G. If you have a tag of hello-world, hello would be prevented
        // as a tag because select2 would match hellow-world in the hidden dropdown
        // and think you are selecting that.
        matcher: () => false,
      }).on('change', () => {
        const tags = this.$editListingTags.val();
        this.model.get('item').set('tags', tags);
        this.$editListingTagsPlaceholder[tags.length ? 'removeClass' : 'addClass']('emptyOfTags');

        if (tags.length >= item.maxTags) {
          this.showMaxTagsWarning();
        } else {
          this.hideMaxTagsWarning();
        }
      }).on('select2:selecting', (e) => {
        if (this.$editListingTags.val().length >= item.maxTags) {
          this.$maxTagsWarning.velocity('callout.flash', { duration: 500 });
          e.preventDefault();
        }
      })
      .next()
      .find('.select2-search__field')
      .attr('maxLength', item.max.tagLength);

      this.$editListingTagsPlaceholder[
        this.$editListingTags.val().length ? 'removeClass' : 'addClass'
      ]('emptyOfTags');

      this.$editListingCategories.select2({
        multiple: true,
        tags: true,
        // dropdownParent needed to fully hide dropdown
        dropdownParent: this.$('#editListingCategoriesDropdown'),
        // This is necessary, see comment in select2 for tags above.
        matcher: () => false,
      }).on('change', () => {
        const count = this.$editListingCategories.val().length;

        this.$editListingCategoriesPlaceholder[
          count ? 'removeClass' : 'addClass'
        ]('emptyOfTags');

        if (count >= item.maxCategories) {
          this.showMaxCatsWarning();
        } else {
          this.hideMaxCatsWarning();
        }
      }).on('select2:selecting', (e) => {
        if (this.$editListingCategories.val().length >= item.maxCategories) {
          this.$maxCatsWarning.velocity('callout.flash', { duration: 500 });
          e.preventDefault();
        }
      });

      this.$editListingCategoriesPlaceholder[
        this.$editListingCategories.val().length ? 'removeClass' : 'addClass'
      ]('emptyOfTags');

      // render shipping options
      this.shippingOptionViews.forEach((shipOptVw) => shipOptVw.remove());
      this.shippingOptionViews = [];
      const shipOptsFrag = document.createDocumentFragment();

      this.model.get('shippingOptions').forEach((shipOpt, shipOptIndex) => {
        const shipOptVw = this.createShippingOptionView({
          model: shipOpt,
          listPosition: shipOptIndex + 1,
        });

        this.shippingOptionViews.push(shipOptVw);
        shipOptVw.render().$el.appendTo(shipOptsFrag);
      });

      this.$shippingOptionsWrap.append(shipOptsFrag);

      // render variants
      if (this.variantsView) this.variantsView.remove();

      this.variantsView = this.createChild(Variants, {
        collection: this.variantOptionsCl,
        maxVariantCount: this.model.max.optionCount,
      });

      this.variantsView.listenTo(this.variantsView, 'variantChoiceChange',
        this.onVariantChoiceChange.bind(this));

      this.$variantsSection.find('.js-variantsContainer').append(
        this.variantsView.render().el
      );

      // render variant inventory
      if (this.variantInventory) this.variantInventory.remove();

      this.variantInventory = this.createChild(VariantInventory, {
        collection: item.get('skus'),
        optionsCl: item.get('options'),
        getPrice: () => this.getFormData(this.$itemPrice).item.price,
        // getCurrency: () => this.getFormData(this.$currencySelect).metadata.pricingCurrency,
        // getCurrency: () => this.model.get('metadata')
        //   .get('pricingCurrency'),
        getCurrency: () => this.currency,
      });

      this.$('.js-variantInventoryTableContainer')
        .html(this.variantInventory.render().el);

      // render coupons
      if (this.couponsView) this.couponsView.remove();

      const couponErrors = {};

      Object.keys(this.model.validationError || {})
        .forEach(errKey => {
          if (errKey.startsWith('listing.coupons[')) {
            couponErrors[errKey.slice(errKey.indexOf('.') + 1)] =
              this.model.validationError[errKey];
          }
        });

      this.couponsView = new Coupons({
        collection: this.coupons,
        maxCouponCount: this.model.max.couponCount,
        couponErrors,
      });

      this.$couponsSection.find('.js-couponsContainer').append(
        this.couponsView.render().el
      );

      this._$scrollLinks = null;
      this._$scrollToSections = null;
      this._$formFields = null;
      this._$currencySelect = null;
      this._$priceInput = null;
      this._$conditionWrap = null;
      this._$buttonSave = null;
      this._$inputPhotoUpload = null;
      this._$photoUploadingLabel = null;
      this._$editListingReturnPolicy = null;
      this._$editListingTermsAndConditions = null;
      this._$sectionShipping = null;
      this._$maxCatsWarning = null;
      this._$maxTagsWarning = null;
      this._$addShipOptSectionHeading = null;
      this._$variantInventorySection = null;
      this._$itemPrice = null;
      this.$photoUploadItems = this.$('.js-photoUploadItems');
      this.$modalContent = this.$('.modalContent');
      this.$tabControls = this.$('.tabControls');
      this.$titleInput = this.$('#editListingTitle');

      installRichEditor(this.$('#editListingDescription'), {
        topLevelClass: 'clrBr',
      });

      if (this.sortablePhotos) this.sortablePhotos.destroy();
      this.sortablePhotos = Sortable.create(this.$photoUploadItems[0], {
        filter: '.js-addPhotoWrap',
        onUpdate: (e) => {
          const imageModels = this.model
            .get('item')
            .get('images')
            .models;

          const movingModel = imageModels[e.oldIndex - 1];
          imageModels.splice(e.oldIndex - 1, 1);
          imageModels.splice(e.newIndex - 1, 0, movingModel);
        },
        onMove: (e) => ($(e.related).hasClass('js-addPhotoWrap') ? false : undefined),
      });

      setTimeout(() => {
        if (!this.rendered) {
          this.rendered = true;
          this.$titleInput.focus();
        }
      });

      setTimeout(() => {
        // restore the scroll position
        if (restoreScrollPos) {
          this.el.scrollTop = prevScrollPos;
        }

        this.throttledOnScroll = _.bind(_.throttle(this.onScroll, 100), this);
        setTimeout(() => this.$el.on('scroll', this.throttledOnScroll), 100);
      });
    });

    return this;
  }
}

